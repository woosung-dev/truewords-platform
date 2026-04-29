"""A/F 측정 xlsx 두 개를 비교하는 Codex 검토용 마크다운 생성.

L별 2건씩 stratified 10건 추출 → Codex가 둘을 비교하기 좋은 형식.

사용:
    PYTHONPATH=. uv run python scripts/build_codex_compare_md.py \\
        --xlsx-a ~/Downloads/notebooklm_qa_A_sentence_new50_*.xlsx \\
        --xlsx-f ~/Downloads/notebooklm_qa_F_paragraph_new50_*.xlsx \\
        --output ~/Downloads/codex_compare_input.md
"""
from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

from openpyxl import load_workbook


def detect_level(level_raw: str) -> str:
    for L in ("L1", "L2", "L3", "L4", "L5"):
        if L in level_raw:
            return L
    return "기타"


def find_answer_col(headers: list[str]) -> str | None:
    for h in headers:
        if "우리 답변" in h:
            return h
    return None


def load_rows(path: Path) -> list[dict]:
    wb = load_workbook(path, data_only=True)
    ws = wb.active
    if ws is None:
        return []
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(h) if h is not None else "" for h in rows[0]]
    out = []
    for r in rows[1:]:
        if not r or all(c is None or c == "" for c in r):
            continue
        out.append({headers[i]: r[i] if i < len(r) else None for i in range(len(headers))})
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx-a", required=True, type=Path)
    parser.add_argument("--xlsx-f", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--per-level", type=int, default=2)
    parser.add_argument("--seed", type=int, default=20260429)
    args = parser.parse_args()

    rows_a = load_rows(args.xlsx_a)
    rows_f = load_rows(args.xlsx_f)
    if not rows_a or not rows_f:
        print(f"⚠️  로드 실패")
        return 1

    headers_a = list(rows_a[0].keys())
    headers_f = list(rows_f[0].keys())
    ans_a = find_answer_col(headers_a)
    ans_f = find_answer_col(headers_f)

    by_q_f = {(r.get("테스트용 질문") or "").strip(): r for r in rows_f}

    # L별 stratify
    rng = random.Random(args.seed)
    by_level: dict[str, list[dict]] = {}
    for r in rows_a:
        L = detect_level(str(r.get("난이도(Level)", "")))
        if L not in ("L1", "L2", "L3", "L4", "L5"):
            continue
        by_level.setdefault(L, []).append(r)

    selected: list[dict] = []
    for L in ("L1", "L2", "L3", "L4", "L5"):
        bucket = by_level.get(L, [])
        n = min(args.per_level, len(bucket))
        picks = rng.sample(bucket, n) if n else []
        selected.extend(picks)

    # 마크다운 생성
    lines = []
    lines.append("# Codex 독립 검토 — 옵션 A (sentence) vs 옵션 F (paragraph)")
    lines.append("")
    lines.append("## 평가 요청")
    lines.append("")
    lines.append("아래 10건의 비교 사례에서 **A와 F 중 어느 답변이 더 정확하고 유용한가**를")
    lines.append("판정해 주세요. 각 사례마다:")
    lines.append("")
    lines.append("- **승자**: A / F / 동등")
    lines.append("- **이유**: 모범답변/참고키워드 대비 정확도, 컨텍스트 활용도, 환각 여부 기준")
    lines.append("")
    lines.append("마지막에 종합 의견:")
    lines.append("- 10건 중 A 승: N, F 승: M, 동등: K")
    lines.append("- 메트릭별(정확도/문맥/환각) 우열 패턴")
    lines.append("- 운영 적용 시 추천 옵션 + 보강할 약점")
    lines.append("")
    lines.append("---")
    lines.append("")

    for idx, r_a in enumerate(selected, 1):
        q = (r_a.get("테스트용 질문") or "").strip()
        L = detect_level(str(r_a.get("난이도(Level)", "")))
        cat = str(r_a.get("카테고리", "") or "")
        gt = str(r_a.get("봇 모범 답변", "") or "")
        kw = str(r_a.get("참고 키워드", "") or "")
        a_answer = str(r_a.get(ans_a, "") if ans_a else "")
        a_ctx = []
        for col in ("참고1", "참고2", "참고3"):
            c = r_a.get(col)
            if c:
                a_ctx.append(str(c)[:300])

        r_f = by_q_f.get(q)
        if not r_f:
            f_answer = "(F 측정 매칭 실패)"
            f_ctx = []
        else:
            f_answer = str(r_f.get(ans_f, "") if ans_f else "")
            f_ctx = []
            for col in ("참고1", "참고2", "참고3"):
                c = r_f.get(col)
                if c:
                    f_ctx.append(str(c)[:300])

        lines.append(f"## 사례 {idx} — {L} / {cat}")
        lines.append("")
        lines.append(f"**질문**: {q}")
        lines.append("")
        lines.append(f"**모범답변**: {gt}")
        lines.append("")
        lines.append(f"**참고키워드**: {kw}")
        lines.append("")
        lines.append("### 옵션 A (sentence chunking)")
        lines.append("")
        lines.append(f"**답변**: {a_answer[:1200]}")
        lines.append("")
        if a_ctx:
            lines.append("**컨텍스트 요약**:")
            for i, c in enumerate(a_ctx, 1):
                lines.append(f"{i}. {c}")
            lines.append("")
        lines.append("### 옵션 F (paragraph chunking)")
        lines.append("")
        lines.append(f"**답변**: {f_answer[:1200]}")
        lines.append("")
        if f_ctx:
            lines.append("**컨텍스트 요약**:")
            for i, c in enumerate(f_ctx, 1):
                lines.append(f"{i}. {c}")
            lines.append("")
        lines.append("---")
        lines.append("")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"생성: {args.output} ({len(selected)} 사례)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
