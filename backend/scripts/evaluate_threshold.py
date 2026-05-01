"""Phase 0 — Cascade threshold cutoff 정책 평가 스크립트.

골든셋(`backend/tests/golden/queries.json`)의 expected_chunk_ids/volumes 를 정답으로 두고
실제 검색 결과의 Recall@10 / MRR@10 / NDCG@10 를 측정한다.

**판정 정책:** judge LLM 미사용 — 사람이 라벨링한 정답 chunk_id/volume 매칭만으로
기계 평가한다. 이는 사용자 명시 정책 (RAGAS 등 judge LLM CI/CD 통합 영구 폐기,
2026-05-01) 을 따른다.

사용:
    # baseline 측정 (현재 코드 기준)
    uv run python -m scripts.evaluate_threshold --baseline > /tmp/baseline.json

    # 정책 변경 후 측정
    uv run python -m scripts.evaluate_threshold --after > /tmp/after.json

    # 비교
    uv run python -m scripts.evaluate_threshold --diff /tmp/baseline.json /tmp/after.json

라벨 미작성 쿼리는 자동 skip. 라벨 채울 때 chunk_id 가 정확하면
`expected_chunk_ids`, 권 단위만 명확하면 `expected_volumes` 사용.

**TODO (다음 PR):** `run_search` stub 을 실제 cascading_search 호출로 채워야
--baseline / --after 가 동작한다. 환경 변수 `EVAL_CHATBOT_ID` 등을 통한
주입 패턴은 staging 환경 셋업과 함께 결정.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from pathlib import Path
from typing import Any


# ── 메트릭 함수 ──────────────────────────────────────────────────────────────


def recall_at_k(expected: set[str], actual: list[str], k: int = 10) -> float:
    """Recall@k — 정답 중 상위 k 안에 들어온 비율."""
    if not expected:
        return 0.0
    return len(expected & set(actual[:k])) / len(expected)


def mrr_at_k(expected: set[str], actual: list[str], k: int = 10) -> float:
    """MRR@k — 첫 정답의 역순위."""
    for rank, item in enumerate(actual[:k], start=1):
        if item in expected:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(expected: set[str], actual: list[str], k: int = 10) -> float:
    """NDCG@k — 정답을 1, 비정답을 0 으로 두는 binary relevance 가정."""
    if not expected:
        return 0.0
    dcg = sum(
        (1.0 / math.log2(rank + 1)) if item in expected else 0.0
        for rank, item in enumerate(actual[:k], start=1)
    )
    idcg = sum(1.0 / math.log2(r + 1) for r in range(1, min(len(expected), k) + 1))
    return dcg / idcg if idcg > 0 else 0.0


# ── 골든셋 로딩 ─────────────────────────────────────────────────────────────


def load_golden(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def is_labeled(q: dict[str, Any]) -> bool:
    return bool(q.get("expected_chunk_ids") or q.get("expected_volumes"))


# ── 검색 호출 (stub — 다음 PR에서 채움) ─────────────────────────────────────


async def run_search(query: str, top_k: int = 10) -> list[dict[str, Any]]:
    """staging Qdrant + 기본 챗봇 설정으로 cascading_search 호출.

    각 결과는 ``{"volume": str, "chunk_index": int, "score": float}`` 형태.

    TODO: 다음 PR 에서 실제 환경 주입 후 활성화.
        예시 (활성화 시):

            from src.qdrant import get_async_client
            from src.search.cascading import cascading_search, CascadingConfig, SearchTier
            client = get_async_client()
            config = CascadingConfig(tiers=[SearchTier(sources=["A", "B"], min_results=3)])
            results = await cascading_search(client, query, config, top_k=top_k)
            return [
                {"volume": r.volume, "chunk_index": r.chunk_index, "score": r.score}
                for r in results
            ]
    """
    raise NotImplementedError(
        "staging Qdrant 클라이언트 + chatbot config 주입 필요. "
        "이 함수를 채운 뒤에만 --baseline / --after 가 실행됩니다. "
        "현재는 골격 + metric 함수 단위 테스트만 검증 완료."
    )


# ── 평가 ────────────────────────────────────────────────────────────────────


async def evaluate_set(golden_path: Path, top_k: int = 10) -> dict[str, Any]:
    data = load_golden(golden_path)
    queries: list[dict[str, Any]] = data.get("queries", [])

    per_query: list[dict[str, Any]] = []
    skipped: list[str] = []
    metrics_acc: dict[str, list[float]] = {
        "recall@10": [],
        "mrr@10": [],
        "ndcg@10": [],
    }

    for q in queries:
        if not is_labeled(q):
            skipped.append(q["id"])
            continue

        results = await run_search(q["query"], top_k=top_k)
        actual_chunks = [f"{r['volume']}:{r['chunk_index']}" for r in results]
        actual_volumes = [r["volume"] for r in results]
        expected_chunks = set(q.get("expected_chunk_ids", []))
        expected_volumes = set(q.get("expected_volumes", []))

        # chunk 라벨 우선, 없으면 volume 라벨로 평가
        if expected_chunks:
            actual = actual_chunks
            expected = expected_chunks
        else:
            actual = actual_volumes
            expected = expected_volumes

        m = {
            "recall@10": recall_at_k(expected, actual, top_k),
            "mrr@10": mrr_at_k(expected, actual, top_k),
            "ndcg@10": ndcg_at_k(expected, actual, top_k),
        }
        for key, val in m.items():
            metrics_acc[key].append(val)

        per_query.append(
            {"id": q["id"], "category": q.get("category"), "metrics": m}
        )

    return {
        "n_queries_total": len(queries),
        "n_evaluated": len(per_query),
        "n_skipped_no_label": len(skipped),
        "skipped_ids": skipped,
        "macro": {
            key: (sum(vals) / len(vals) if vals else None)
            for key, vals in metrics_acc.items()
        },
        "per_query": per_query,
    }


# ── diff ───────────────────────────────────────────────────────────────────


def diff_runs(baseline: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    bm = baseline.get("macro", {})
    am = after.get("macro", {})
    diff: dict[str, Any] = {}
    for key in ("recall@10", "mrr@10", "ndcg@10"):
        b = bm.get(key)
        a = am.get(key)
        d = (a - b) if (a is not None and b is not None) else None
        diff[key] = {"baseline": b, "after": a, "delta": d}
    return {
        "n_evaluated_baseline": baseline.get("n_evaluated"),
        "n_evaluated_after": after.get("n_evaluated"),
        "diff": diff,
    }


# ── CLI ────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Phase 0 cascade threshold cutoff 정책 평가 (judge LLM 미사용)"
    )
    parser.add_argument(
        "--golden",
        default="tests/golden/queries.json",
        help="골든셋 JSON 경로 (default: tests/golden/queries.json)",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--baseline", action="store_true", help="현재 코드 기준 baseline 측정"
    )
    group.add_argument(
        "--after", action="store_true", help="정책 변경 후 측정"
    )
    group.add_argument(
        "--diff",
        nargs=2,
        metavar=("BASELINE_JSON", "AFTER_JSON"),
        help="두 결과 비교",
    )
    args = parser.parse_args(argv)

    if args.diff:
        baseline = json.loads(Path(args.diff[0]).read_text(encoding="utf-8"))
        after = json.loads(Path(args.diff[1]).read_text(encoding="utf-8"))
        out = diff_runs(baseline, after)
    else:
        out = asyncio.run(evaluate_set(Path(args.golden)))

    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
