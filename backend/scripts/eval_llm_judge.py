"""LLM-as-Judge 정성평가 + 키워드 포함률 F1.

Phase 2 옵션 A vs F 비교용 신규 평가 스크립트.

평가 방식:
  - 정성 4메트릭 (각 1~5점 정수, 총 4~20):
      answer_correctness, context_relevance, context_faithfulness, context_recall
  - 키워드 F1: 참고키워드(콤마 구분) → 답변 substring 매칭으로 micro precision/recall/F1

입력: seed JSON (build_ragas_seeds_from_ab.py --xlsx 모드 출력)
      각 item: {id, level, category, question, answer, ground_truth, keywords[], contexts[]}

출력:
  - {prefix}_detail.csv  : id/level/question/4점수/F1/precision/recall/analysis
  - {prefix}_summary.md  : 평균/L별 분포/하위5/약점 진단

사용:
    PYTHONPATH=. uv run python scripts/eval_llm_judge.py \\
        --seed ~/Downloads/ragas_seed_F_new50_*.json \\
        --output-prefix ~/Downloads/llm_judge_F_new50
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import sys
import time
from pathlib import Path
from statistics import mean

from google import genai
from google.genai import types

from src.config import settings


EVAL_MODEL = "gemini-3.1-flash-lite-preview"
CONCURRENCY = 5

JUDGE_PROMPT = """당신은 RAG 시스템 평가 전문가입니다. 다음 정보를 바탕으로 답변 품질을 평가하세요.

[질문]
{question}

[검색된 컨텍스트]
{contexts}

[생성된 답변]
{prediction}

[참조 답변(정답)]
{label}

다음 4가지 기준을 1~5점 정수로 평가하세요:

1. **answer_correctness**: 정답 대비 답변의 사실 정확도. 핵심 사실이 일치하면 5점, 일부만 맞거나 보강 정보가 부정확하면 3~4점, 잘못된 사실이 포함되면 1~2점.
2. **context_relevance**: 검색된 컨텍스트가 질문에 얼마나 관련 있는가. 모든 컨텍스트가 직접 관련되면 5점, 일부만 관련되면 3~4점, 무관한 컨텍스트가 다수면 1~2점.
3. **context_faithfulness**: 답변이 컨텍스트에 충실한가 (환각 없음). 답변 모든 주장이 컨텍스트로 입증되면 5점, 일부 추정/추론이 섞이면 3~4점, 명백한 환각이 있으면 1~2점.
4. **context_recall**: 컨텍스트가 정답을 도출하기에 충분한 정보를 담고 있는가. 정답의 모든 주장이 컨텍스트에 있으면 5점, 일부만 있으면 3~4점, 정답 도출이 어려우면 1~2점.

JSON으로만 응답 (다른 텍스트 금지):
{{
  "answer_correctness": <1-5>,
  "context_relevance": <1-5>,
  "context_faithfulness": <1-5>,
  "context_recall": <1-5>,
  "analysis": "<2~4문장 종합 분석>"
}}
"""


METRICS = [
    "answer_correctness",
    "context_relevance",
    "context_faithfulness",
    "context_recall",
]


def parse_judge_json(text: str) -> dict | None:
    """LLM 응답에서 JSON 추출 + 점수 검증."""
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        text = m.group(1)
    else:
        m = re.search(r"(\{[\s\S]*?\})", text)
        if m:
            text = m.group(1)
    try:
        d = json.loads(text)
        out = {}
        for m_name in METRICS:
            v = d.get(m_name)
            if v is None:
                return None
            iv = int(v)
            if not 1 <= iv <= 5:
                return None
            out[m_name] = iv
        out["analysis"] = str(d.get("analysis", ""))[:500]
        return out
    except (json.JSONDecodeError, ValueError, TypeError):
        return None


def compute_keyword_f1(prediction: str, keywords: list[str]) -> dict:
    """참고키워드 substring 매칭 기반 micro precision/recall/F1."""
    if not keywords:
        return {"precision": None, "recall": None, "f1": None,
                "matched": 0, "total": 0}
    pred_norm = (prediction or "").replace(" ", "")
    matched_kw = []
    for kw in keywords:
        kw_norm = kw.replace(" ", "")
        if kw_norm and kw_norm in pred_norm:
            matched_kw.append(kw)
    matched = len(matched_kw)
    total = len(keywords)
    # 단일 샘플 micro 계산: precision = recall = F1 = matched/total
    # (참조 키워드가 prediction에 있는지만 확인하므로 FP는 정의 불가 → recall만 의미)
    # micro-aggregation 시에는 matched/total 합산이 곧 micro-recall이고
    # 키워드 set 외부의 답변 단어를 FP로 셀 수 없으므로 precision=recall=F1로 간주
    recall = matched / total
    return {
        "precision": recall,
        "recall": recall,
        "f1": recall,
        "matched": matched,
        "total": total,
    }


async def judge_one(
    client, item: dict, semaphore: asyncio.Semaphore, idx: int, total: int
) -> dict:
    contexts_text = "\n\n".join(
        f"[컨텍스트 {i+1}]\n{c}" for i, c in enumerate(item.get("contexts", []))
    )
    prompt = JUDGE_PROMPT.format(
        question=item.get("question", ""),
        contexts=contexts_text,
        prediction=item.get("answer", ""),
        label=item.get("ground_truth", ""),
    )
    keywords = item.get("keywords", []) or []
    f1 = compute_keyword_f1(item.get("answer", ""), keywords)

    async with semaphore:
        for attempt in range(3):
            try:
                resp = await client.aio.models.generate_content(
                    model=EVAL_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(temperature=0),
                )
                scores = parse_judge_json(resp.text or "")
                if scores:
                    total_score = sum(scores[m] for m in METRICS)
                    print(
                        f"  [{idx+1}/{total}] L={item.get('level','?')} "
                        f"ac={scores['answer_correctness']} "
                        f"cr={scores['context_relevance']} "
                        f"cf={scores['context_faithfulness']} "
                        f"crc={scores['context_recall']} "
                        f"sum={total_score} "
                        f"f1={f1['f1']:.2f}" if f1['f1'] is not None else f"f1=-",
                        flush=True,
                    )
                    return {
                        "id": item.get("id", str(idx)),
                        "level": item.get("level", ""),
                        "question": item.get("question", ""),
                        **scores,
                        "total_score": total_score,
                        "kw_precision": f1["precision"],
                        "kw_recall": f1["recall"],
                        "kw_f1": f1["f1"],
                        "kw_matched": f1["matched"],
                        "kw_total": f1["total"],
                    }
                print(f"  [{idx+1}/{total}] parse 실패 retry {attempt+1}/3", flush=True)
            except Exception as e:
                print(
                    f"  [{idx+1}/{total}] error: {type(e).__name__}: {e} retry {attempt+1}/3",
                    flush=True,
                )
                await asyncio.sleep(5)
    return {
        "id": item.get("id", str(idx)),
        "level": item.get("level", ""),
        "question": item.get("question", ""),
        **{m: None for m in METRICS},
        "analysis": "FAILED",
        "total_score": None,
        "kw_precision": f1["precision"],
        "kw_recall": f1["recall"],
        "kw_f1": f1["f1"],
        "kw_matched": f1["matched"],
        "kw_total": f1["total"],
    }


def write_detail_csv(path: Path, results: list[dict]) -> None:
    fieldnames = [
        "id", "level", "question",
        "answer_correctness", "context_relevance",
        "context_faithfulness", "context_recall",
        "total_score",
        "kw_precision", "kw_recall", "kw_f1", "kw_matched", "kw_total",
        "analysis",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in results:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def write_summary_md(path: Path, label: str, results: list[dict]) -> None:
    valid = [r for r in results if r.get("total_score") is not None]
    n_valid = len(valid)
    n_total = len(results)

    avg_metrics = {
        m: mean(r[m] for r in valid) if valid else None
        for m in METRICS
    }
    avg_total = mean(r["total_score"] for r in valid) if valid else None

    f1_valid = [r for r in results if r.get("kw_f1") is not None]
    avg_f1 = mean(r["kw_f1"] for r in f1_valid) if f1_valid else None

    # L별 평균
    by_level: dict[str, list[dict]] = {}
    for r in valid:
        L = r.get("level", "?")
        by_level.setdefault(L, []).append(r)

    # 하위 5 (총점 낮은 순)
    bottom5 = sorted(valid, key=lambda r: r["total_score"])[:5]

    # 등급
    grade = "-"
    if avg_total is not None:
        if avg_total >= 18: grade = "우수 (양산 적용 가능)"
        elif avg_total >= 15: grade = "양호 (일부 약점 보강 후 적용)"
        elif avg_total >= 12: grade = "보통 (약점 메트릭 집중 개선)"
        else: grade = "미흡 (재설계 필요)"

    f1_grade = "-"
    if avg_f1 is not None:
        if avg_f1 >= 0.90: f1_grade = "매우 정확"
        elif avg_f1 >= 0.70: f1_grade = "양호"
        elif avg_f1 >= 0.50: f1_grade = "신뢰도 낮음"
        else: f1_grade = "사실상 미작동"

    lines = []
    lines.append(f"# LLM-Judge 정성평가 — {label}")
    lines.append("")
    lines.append(f"- 표본: {n_valid}/{n_total}건 유효")
    lines.append("")
    lines.append("## 정성 4메트릭 평균")
    lines.append("")
    lines.append("| 메트릭 | 평균 (1~5) |")
    lines.append("|---|---:|")
    for m in METRICS:
        v = avg_metrics.get(m)
        lines.append(f"| {m} | {v:.2f} |" if v is not None else f"| {m} | - |")
    lines.append(f"| **총점 (4~20)** | **{avg_total:.2f}** |" if avg_total is not None else "| **총점** | - |")
    lines.append("")
    lines.append(f"**등급**: {grade}")
    lines.append("")
    lines.append("## 키워드 포함률 F1")
    lines.append("")
    lines.append(f"- 평균 F1: **{avg_f1:.3f}**" if avg_f1 is not None else "- 평균 F1: -")
    lines.append(f"- 등급: {f1_grade}")
    lines.append("")
    lines.append("## L별 평균 총점")
    lines.append("")
    lines.append("| 난이도 | n | 총점 평균 | answer_correctness | context_relevance | context_faithfulness | context_recall |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    for L in sorted(by_level.keys()):
        rs = by_level[L]
        n = len(rs)
        lines.append(
            f"| {L} | {n} | {mean(r['total_score'] for r in rs):.2f} | "
            f"{mean(r['answer_correctness'] for r in rs):.2f} | "
            f"{mean(r['context_relevance'] for r in rs):.2f} | "
            f"{mean(r['context_faithfulness'] for r in rs):.2f} | "
            f"{mean(r['context_recall'] for r in rs):.2f} |"
        )
    lines.append("")
    lines.append("## 하위 5건 (총점 낮은 순)")
    lines.append("")
    for r in bottom5:
        lines.append(f"- **{r['id']}** ({r['level']}, 총점 {r['total_score']}): {r['question'][:80]}")
        lines.append(f"  - {r.get('analysis','')[:200]}")
    lines.append("")
    lines.append("## 약점 진단")
    lines.append("")
    weak = []
    if avg_metrics.get("answer_correctness") and avg_metrics["answer_correctness"] < 4.0:
        weak.append(f"- answer_correctness 평균 {avg_metrics['answer_correctness']:.2f} (< 4.0): 사실 정확도 약점")
    if avg_metrics.get("context_relevance") and avg_metrics["context_relevance"] < 4.0:
        weak.append(f"- context_relevance 평균 {avg_metrics['context_relevance']:.2f} (< 4.0): 검색 품질 약점")
    if avg_metrics.get("context_faithfulness") and avg_metrics["context_faithfulness"] < 4.0:
        weak.append(f"- context_faithfulness 평균 {avg_metrics['context_faithfulness']:.2f} (< 4.0): 환각 위험")
    if avg_metrics.get("context_recall") and avg_metrics["context_recall"] < 4.0:
        weak.append(f"- context_recall 평균 {avg_metrics['context_recall']:.2f} (< 4.0): 컨텍스트 정보 부족")
    if not weak:
        weak.append("- 모든 메트릭 평균 ≥ 4.0 — 약점 없음")
    lines.extend(weak)
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


async def main_async(args) -> int:
    items = json.loads(args.seed.read_text(encoding="utf-8"))
    if args.limit:
        items = items[: args.limit]
    print(f"[load] {args.seed.name}: {len(items)}건 (concurrency={CONCURRENCY})")

    client = genai.Client(api_key=settings.gemini_api_key.get_secret_value())
    semaphore = asyncio.Semaphore(CONCURRENCY)

    t0 = time.time()
    tasks = [
        judge_one(client, item, semaphore, i, len(items))
        for i, item in enumerate(items)
    ]
    results = await asyncio.gather(*tasks)
    elapsed = time.time() - t0

    out_prefix: Path = args.output_prefix
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    detail_path = out_prefix.with_name(out_prefix.name + "_detail.csv")
    summary_path = out_prefix.with_name(out_prefix.name + "_summary.md")
    write_detail_csv(detail_path, results)
    label = args.label or out_prefix.name
    write_summary_md(summary_path, label, results)

    valid = [r for r in results if r.get("total_score") is not None]
    avg_total = mean(r["total_score"] for r in valid) if valid else None
    f1_valid = [r for r in results if r.get("kw_f1") is not None]
    avg_f1 = mean(r["kw_f1"] for r in f1_valid) if f1_valid else None

    print()
    print(f"=== 결과 ({elapsed:.1f}s) ===")
    if avg_total is not None:
        print(f"  총점 평균 (4~20): {avg_total:.2f}  n={len(valid)}/{len(items)}")
    if avg_f1 is not None:
        print(f"  키워드 F1 평균: {avg_f1:.3f}  n={len(f1_valid)}/{len(items)}")
    print(f"  detail: {detail_path}")
    print(f"  summary: {summary_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--output-prefix", required=True, type=Path,
                        help="출력 prefix (예: ~/Downloads/llm_judge_F_new50)")
    parser.add_argument("--label", type=str, default=None,
                        help="요약 보고서 제목용 라벨 (기본: prefix 이름)")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
