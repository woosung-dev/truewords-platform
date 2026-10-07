"""Phase 0 — Cascade threshold cutoff 정책 평가 스크립트.

골든셋(`apps/api/tests/golden/queries.json`)의 expected_chunk_ids/volumes 를 정답으로 두고
실제 검색 결과의 Recall@10 / MRR@10 / NDCG@10 를 측정한다.

**판정 정책:** judge LLM 미사용 — 사람이 라벨링한 정답 chunk_id/volume 매칭만으로
기계 평가한다. 이는 사용자 명시 정책 (RAGAS 등 judge LLM CI/CD 통합 영구 폐기,
2026-05-01) 을 따른다.

사용 (DB 의 챗봇 search_tiers 로 운영 검색 단계와 같은 경로를 탄다):
    # baseline 측정 (rerank 없이 검색만)
    uv run python -m scripts.evaluate_threshold --baseline --chatbot-id all > /tmp/baseline.json

    # 운영처럼 Gemini rerank 까지 적용
    uv run python -m scripts.evaluate_threshold --baseline --chatbot-id all --rerank > /tmp/baseline.json

    # 정책 변경 후 측정
    uv run python -m scripts.evaluate_threshold --after --chatbot-id all > /tmp/after.json

    # 비교
    uv run python -m scripts.evaluate_threshold --diff /tmp/baseline.json /tmp/after.json

라벨 미작성 쿼리는 자동 skip. 라벨 채울 때 chunk_id 가 정확하면
`expected_chunk_ids`, 권 단위만 명확하면 `expected_volumes` 사용.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
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


# ── 검색 호출 (운영 SearchStage·RerankStage 와 같은 경로) ───────────────────


async def load_search_config(chatbot_id: str) -> Any:
    """DB 챗봇 설정 → 운영 SearchStage 가 쓰는 cascading/weighted config."""
    from app.core.common.database import async_session_factory
    from app.modules.chat.pipeline.stages.search import _to_search_config
    from app.modules.chat.service import DEFAULT_RUNTIME_CONFIG
    from app.modules.chatbot.repository import ChatbotRepository
    from app.modules.chatbot.service import ChatbotService

    async with async_session_factory() as session:
        runtime_config = await ChatbotService(ChatbotRepository(session)).build_runtime_config(chatbot_id)
    if runtime_config is None:
        raise ValueError(f"chatbot_id={chatbot_id!r} 설정을 찾을 수 없습니다")
    return _to_search_config(runtime_config.search, DEFAULT_RUNTIME_CONFIG.search.tiers)


async def run_search(
    query: str,
    search_config: Any,
    top_k: int = 10,
    rerank_enabled: bool = False,
) -> list[dict[str, Any]]:
    """top-50 검색 → 0건이면 fallback → rerank 또는 상위 top_k 자르기.

    운영 rerank 는 intent 별 15/12/8건을 남기지만 @10 지표를 위해 top_k 로 고정한다.
    각 결과는 ``{"volume", "chunk_index", "score", "rerank_score"}`` 형태.
    rerank 실패 시 운영과 같이 원래 순서로 돌아가며 rerank_score 는 None 이다.
    """
    from app.core.common.gemini import embed_dense_query
    from app.modules.qdrant import get_raw_client
    from app.modules.search.cascading import cascading_search
    from app.modules.search.collection_resolver import resolve_collections
    from app.modules.search.fallback import fallback_search
    from app.modules.search.metadata_extractor import extract_query_metadata
    from app.modules.search.reranker import rerank
    from app.modules.search.weighted import WeightedConfig, weighted_search

    client = get_raw_client()
    collection = resolve_collections().main
    embedding = await embed_dense_query(query)
    search_kwargs: dict[str, Any] = {
        "top_k": 50,
        "dense_embedding": embedding,
        "collection_name": collection,
        "query_metadata": extract_query_metadata(query),
    }
    if isinstance(search_config, WeightedConfig):
        results = await weighted_search(client, query, search_config, **search_kwargs)
    else:
        results = await cascading_search(client, query, search_config, **search_kwargs)
    if not results:
        results, _ = await fallback_search(
            client=client, query=query, original_results=results,
            dense_embedding=embedding, collection_name=collection,
        )
    if rerank_enabled and results:
        results = await rerank(query, results, top_k=top_k)
    else:
        results = results[:top_k]
    return [
        {
            "volume": r.volume,
            "chunk_index": r.chunk_index,
            "score": r.score,
            "rerank_score": r.rerank_score,
        }
        for r in results
    ]


# ── 평가 ────────────────────────────────────────────────────────────────────


async def evaluate_set(
    golden_path: Path,
    chatbot_id: str,
    top_k: int = 10,
    rerank_enabled: bool = False,
) -> dict[str, Any]:
    data = load_golden(golden_path)
    queries: list[dict[str, Any]] = data.get("queries", [])
    search_config = await load_search_config(chatbot_id)

    per_query: list[dict[str, Any]] = []
    skipped: list[str] = []
    rerank_failed: list[str] = []
    metrics_acc: dict[str, list[float]] = {
        "recall@10": [],
        "mrr@10": [],
        "ndcg@10": [],
    }

    for q in queries:
        if not is_labeled(q):
            skipped.append(q["id"])
            continue

        results = await run_search(
            q["query"], search_config, top_k=top_k, rerank_enabled=rerank_enabled
        )
        if rerank_enabled and results and all(r["rerank_score"] is None for r in results):
            rerank_failed.append(q["id"])
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

    # 유형(factoid/conceptual/reasoning)별 평균 — 유형마다 효과가 갈리는 이력이 있어 함께 본다
    by_category: dict[str, dict[str, float]] = {}
    for category in sorted({p["category"] for p in per_query if p["category"]}):
        rows = [p["metrics"] for p in per_query if p["category"] == category]
        by_category[category] = {
            key: sum(r[key] for r in rows) / len(rows) for key in metrics_acc
        } | {"n": len(rows)}

    return {
        "chatbot_id": chatbot_id,
        "rerank_enabled": rerank_enabled,
        "n_queries_total": len(queries),
        "n_evaluated": len(per_query),
        "n_skipped_no_label": len(skipped),
        "skipped_ids": skipped,
        "rerank_failed_ids": rerank_failed,
        "macro": {
            key: (sum(vals) / len(vals) if vals else None)
            for key, vals in metrics_acc.items()
        },
        "macro_by_category": by_category,
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
    parser.add_argument(
        "--chatbot-id",
        default=os.environ.get("EVAL_CHATBOT_ID"),
        help="DB 챗봇 슬러그 (예: all). 그 봇의 search_tiers 로 검색한다. env EVAL_CHATBOT_ID 대체 가능",
    )
    parser.add_argument(
        "--rerank", action="store_true", help="운영처럼 Gemini rerank 까지 적용"
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
        if not args.chatbot_id:
            parser.error("--baseline / --after 는 --chatbot-id (또는 EVAL_CHATBOT_ID) 가 필요합니다")
        out = asyncio.run(
            evaluate_set(
                Path(args.golden), args.chatbot_id, rerank_enabled=args.rerank
            )
        )

    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
