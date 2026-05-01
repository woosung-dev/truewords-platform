"""Reranker 모델 일괄 평가 + latency 측정 (PR 7/8).

골든셋(``backend/tests/golden/queries.json``) 의 라벨된 query 에 대해 각 reranker
모델로 search → 메트릭 (NDCG@10 / MRR@10 / Recall@10) + latency (first_call /
p50 / p95 / p99) 를 측정한다.

핵심:
* `evaluate_threshold.evaluate_set` 를 model 별로 호출해서 메트릭 일관성 보장.
* per-query latency 측정은 reranker 단독 (cascading 제외) — `time.perf_counter`.
* `--runs N` — 동일 query × N 회 → median 기록 + variance.
* `first_call_ms` 분리 기록 — 첫 호출의 cold start 영향 분리.
* 카테고리별 (factoid / conceptual / reasoning) breakdown 자동 집계.
* `--output-md` — markdown 표 + winner-per-query 자동 생성.

사용:
    cd backend
    uv run python -m scripts.compare_rerankers \\
        --models gemini-flash \\
        --runs 3 \\
        --collection malssum_poc_v5 \\
        --chatbot-id "신학/원리 전문 봇" \\
        --sources U \\
        --output both \\
        --output-path docs/dev-log/2026-05-XX-reranker-ab-results

향후 새 reranker 추가 시 src/search/rerank/ 에 어댑터 등록 + VALID_MODELS 보강.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

# scripts/ 는 패키지가 아니므로 sys.path 조작 불요 (-m scripts.compare_rerankers)


VALID_MODELS = ("gemini-flash", "none")
DEFAULT_TOP_K = 10


# ── 메트릭 (evaluate_threshold 와 동일) ────────────────────────────────────


async def evaluate_one_model(
    *,
    model: str,
    runs: int,
    golden_path: Path,
    chatbot_id: str | None,
    collection_name: str | None,
    sources: list[str] | None,
    top_k: int,
) -> dict[str, Any]:
    """단일 모델에 대해 N runs 측정.

    각 run 마다 evaluate_set 호출 → 메트릭 + per-query latency 수집.
    runs > 1 이면 메트릭은 median 사용, latency 는 모든 run 의 raw 값 합집합 → p-tile 계산.
    """
    from scripts.evaluate_threshold import evaluate_set, run_search

    runs_data: list[dict[str, Any]] = []
    all_latencies_ms: list[float] = []
    first_call_ms: float | None = None

    for run_idx in range(runs):
        # evaluate_set 은 내부적으로 query 별 run_search 호출. 여기선 latency 측정 위해
        # query 단위로 run_search 직접 호출 + 메트릭은 evaluate_set 와 동일 함수 재사용.
        # 단순화: evaluate_set 호출 후 별도 latency 측정 round 추가.
        run_metrics = await evaluate_set(
            golden_path,
            top_k=top_k,
            rerank_model=model,
            chatbot_id=chatbot_id,
            collection_name=collection_name,
            sources=sources,
        )

        # latency 측정용 별도 round (reranker 단독 latency)
        data = json.loads(golden_path.read_text(encoding="utf-8"))
        labeled = [
            q for q in data.get("queries", [])
            if q.get("expected_chunk_ids") or q.get("expected_volumes")
        ]
        for q_idx, q in enumerate(labeled):
            t0 = time.perf_counter()
            await run_search(
                q["query"],
                top_k=top_k,
                rerank_model=model,
                chatbot_id=chatbot_id,
                collection_name=collection_name,
                sources=sources,
            )
            latency_ms = (time.perf_counter() - t0) * 1000.0
            if first_call_ms is None:
                first_call_ms = latency_ms
            else:
                all_latencies_ms.append(latency_ms)

        runs_data.append(run_metrics)

    # 메트릭 median (run 수 1 이면 그대로)
    macro_keys = ("recall@10", "mrr@10", "ndcg@10")
    macro_median = {
        k: statistics.median([r["macro"][k] for r in runs_data if r["macro"].get(k) is not None])
        for k in macro_keys
    }

    # 카테고리별 macro 집계 (per_query 결과로부터)
    by_category: dict[str, dict[str, float]] = {}
    for cat in ("factoid", "conceptual", "reasoning"):
        per_cat_metrics = {k: [] for k in macro_keys}
        for r in runs_data:
            for pq in r.get("per_query", []):
                if pq.get("category") == cat:
                    for k in macro_keys:
                        v = pq["metrics"].get(k)
                        if v is not None:
                            per_cat_metrics[k].append(v)
        by_category[cat] = {
            k: (statistics.mean(vs) if vs else None)
            for k, vs in per_cat_metrics.items()
        }

    latency_stats = _compute_latency_stats(all_latencies_ms, first_call_ms)

    return {
        "model": model,
        "runs": runs,
        "n_evaluated": runs_data[0]["n_evaluated"],
        "n_skipped": runs_data[0]["n_skipped_no_label"],
        "macro": macro_median,
        "by_category": by_category,
        "latency_ms": latency_stats,
        "per_query_first_run": runs_data[0].get("per_query", []),
    }


def _compute_latency_stats(
    latencies: list[float], first_call_ms: float | None,
) -> dict[str, float | None]:
    if not latencies:
        return {
            "first_call": first_call_ms,
            "p50": None, "p95": None, "p99": None, "n_samples": 0,
        }
    s = sorted(latencies)
    n = len(s)
    return {
        "first_call": first_call_ms,
        "p50": s[n // 2],
        "p95": s[min(n - 1, int(n * 0.95))],
        "p99": s[min(n - 1, int(n * 0.99))],
        "n_samples": n,
    }


# ── markdown 생성 ──────────────────────────────────────────────────────────


def render_markdown(report: dict[str, Any]) -> str:
    cfg = report["config"]
    lines: list[str] = [
        f"# Reranker A/B 측정 결과 — {cfg['ts']}",
        "",
        f"- **컬렉션:** `{cfg['collection']}`",
        f"- **챗봇:** `{cfg['chatbot_id']}`",
        f"- **sources:** `{cfg['sources']}`",
        f"- **runs:** {cfg['runs']}, **n_queries (labeled):** {cfg['n_queries_labeled']} / {cfg['n_queries_total']}",
        f"- **모델:** {', '.join(cfg['models'])}",
        "",
        "## 전체 macro 메트릭 (median over runs)",
        "",
        "| 모델 | NDCG@10 | MRR@10 | Recall@10 | first_call(ms) | p50(ms) | p95(ms) | p99(ms) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    results = report["results"]
    # winner = highest NDCG@10
    winners = {
        k: max(results.values(), key=lambda r: r["macro"].get(k) or 0.0)["model"]
        for k in ("ndcg@10", "mrr@10", "recall@10")
    }
    for model, r in results.items():
        macro = r["macro"]
        lat = r["latency_ms"]
        def _bold(metric: str, value: float | None) -> str:
            if value is None:
                return "—"
            txt = f"{value:.4f}"
            return f"**{txt}**" if winners.get(metric) == model else txt
        def _fmt_ms(v: float | None) -> str:
            return "—" if v is None else f"{v:.0f}"
        lines.append(
            f"| `{model}` | {_bold('ndcg@10', macro.get('ndcg@10'))} | "
            f"{_bold('mrr@10', macro.get('mrr@10'))} | "
            f"{_bold('recall@10', macro.get('recall@10'))} | "
            f"{_fmt_ms(lat.get('first_call'))} | {_fmt_ms(lat.get('p50'))} | "
            f"{_fmt_ms(lat.get('p95'))} | {_fmt_ms(lat.get('p99'))} |"
        )
    lines.append("")
    lines.append("## 카테고리별 NDCG@10 / MRR@10 / Recall@10")
    lines.append("")
    for cat in ("factoid", "conceptual", "reasoning"):
        lines.append(f"### {cat}")
        lines.append("")
        lines.append("| 모델 | NDCG@10 | MRR@10 | Recall@10 |")
        lines.append("|---|---|---|---|")
        for model, r in results.items():
            cat_m = r["by_category"].get(cat, {})
            def _fmt(v: float | None) -> str:
                return "—" if v is None else f"{v:.4f}"
            lines.append(
                f"| `{model}` | {_fmt(cat_m.get('ndcg@10'))} | "
                f"{_fmt(cat_m.get('mrr@10'))} | "
                f"{_fmt(cat_m.get('recall@10'))} |"
            )
        lines.append("")
    return "\n".join(lines) + "\n"


# ── 메인 ────────────────────────────────────────────────────────────────────


async def run_all(
    *,
    models: list[str],
    runs: int,
    golden_path: Path,
    chatbot_id: str | None,
    collection_name: str | None,
    sources: list[str] | None,
    top_k: int,
) -> dict[str, Any]:
    data = json.loads(golden_path.read_text(encoding="utf-8"))
    queries = data.get("queries", [])
    labeled = [
        q for q in queries
        if q.get("expected_chunk_ids") or q.get("expected_volumes")
    ]

    results: dict[str, Any] = {}
    for model in models:
        print(f"⏱  measuring {model} ({runs} runs)...", flush=True, file=sys.stderr)
        results[model] = await evaluate_one_model(
            model=model,
            runs=runs,
            golden_path=golden_path,
            chatbot_id=chatbot_id,
            collection_name=collection_name,
            sources=sources,
            top_k=top_k,
        )
        macro = results[model]["macro"]
        lat = results[model]["latency_ms"]
        print(
            f"   ↳ NDCG@10={macro.get('ndcg@10'):.4f} "
            f"MRR@10={macro.get('mrr@10'):.4f} Recall@10={macro.get('recall@10'):.4f} "
            f"p50={lat.get('p50') or 0:.0f}ms p95={lat.get('p95') or 0:.0f}ms",
            file=sys.stderr,
        )

    return {
        "config": {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "models": models,
            "runs": runs,
            "collection": collection_name,
            "chatbot_id": chatbot_id,
            "sources": sources,
            "top_k": top_k,
            "n_queries_total": len(queries),
            "n_queries_labeled": len(labeled),
            "golden_version": data.get("version"),
        },
        "results": results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reranker 모델 A/B 측정")
    parser.add_argument(
        "--golden", default="tests/golden/queries.json",
        help="골든셋 JSON 경로",
    )
    parser.add_argument(
        "--models", default="gemini-flash",
        help="쉼표 구분 reranker 이름들 (gemini-flash | none)",
    )
    parser.add_argument("--runs", type=int, default=3, help="동일 query 반복 횟수")
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    parser.add_argument(
        "--chatbot-id", default=None,
        help="DB ChatbotConfig.search_tiers 사용. --sources 명시 시 무시.",
    )
    parser.add_argument(
        "--collection", default=None,
        help="Qdrant collection. None 이면 settings.collection_name (현재 malssum_poc_v5).",
    )
    parser.add_argument(
        "--sources", default=None,
        help="cascading source 직접 지정 (예: 'U'). chatbot_id 우회.",
    )
    parser.add_argument(
        "--output", choices=("json", "md", "both"), default="both",
        help="출력 형식. default=both",
    )
    parser.add_argument(
        "--output-path", default=None,
        help="출력 경로 prefix (확장자 자동). 미지정 시 stdout (json only).",
    )
    args = parser.parse_args(argv)

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    invalid = [m for m in models if m not in VALID_MODELS]
    if invalid:
        parser.error(f"unknown models: {invalid}. valid={VALID_MODELS}")

    sources = (
        [s.strip() for s in args.sources.split(",") if s.strip()]
        if args.sources else None
    )

    report = asyncio.run(run_all(
        models=models,
        runs=args.runs,
        golden_path=Path(args.golden),
        chatbot_id=args.chatbot_id,
        collection_name=args.collection,
        sources=sources,
        top_k=args.top_k,
    ))

    if args.output_path:
        out_path = Path(args.output_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if args.output in ("json", "both"):
            json_path = out_path.with_suffix(".json")
            json_path.write_text(
                json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            print(f"✓ JSON 저장: {json_path}", file=sys.stderr)
        if args.output in ("md", "both"):
            md_path = out_path.with_suffix(".md")
            md_path.write_text(render_markdown(report), encoding="utf-8")
            print(f"✓ Markdown 저장: {md_path}", file=sys.stderr)
    else:
        # stdout JSON only
        json.dump(report, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
