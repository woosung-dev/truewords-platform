"""Phase 0 — Cascade threshold cutoff 정책 + Reranker A/B 평가 스크립트.

골든셋(`backend/tests/golden/queries.json`)의 expected_chunk_ids/volumes 를 정답으로 두고
실제 검색 결과의 Recall@10 / MRR@10 / NDCG@10 를 측정한다.

**판정 정책:** judge LLM 미사용 — 사람이 라벨링한 정답 chunk_id/volume 매칭만으로
기계 평가한다. 이는 사용자 명시 정책 (RAGAS 등 judge LLM CI/CD 통합 영구 폐기,
2026-05-01) 을 따른다.

사용:
    # baseline 측정 (Gemini reranker, 시스템 기본 config)
    uv run python -m scripts.evaluate_threshold --baseline --rerank-model gemini-flash > /tmp/baseline.json

    # 향후 새 reranker 추가 시 동일 패턴
    uv run python -m scripts.evaluate_threshold --after --rerank-model gemini-flash > /tmp/after.json

    # chatbot 별 search_tiers 사용 시
    EVAL_CHATBOT_ID=<uuid> uv run python -m scripts.evaluate_threshold --baseline

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

RERANKER_CHOICES = ("gemini-flash", "none")


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


# ── 검색 호출 (cascading_search + reranker) ─────────────────────────────────


async def _build_eval_cascading_config(
    chatbot_id: str | None,
    sources_override: list[str] | None = None,
):
    """eval cascading config 생성.

    우선순위:
    1. ``sources_override`` 명시 시 — 단일 SearchTier 사용 (chatbot_id 무시).
       측정용 컬렉션 (예: malssum_poc_v5 = source U) 와 production
       chatbot.search_tiers (예: L/M/N) mismatch 회피.
    2. ``chatbot_id`` 명시 시 — DB ``ChatbotConfig.search_tiers`` 사용.
    3. 둘 다 없으면 시스템 기본 (cascading sources=A,B,C / min_results=3 / score_threshold=0.1).
    """
    from src.search.cascading import CascadingConfig, SearchTier

    if sources_override:
        return CascadingConfig(
            tiers=[SearchTier(
                sources=sources_override, min_results=10, score_threshold=0.0,
            )]
        )

    if chatbot_id is None:
        return CascadingConfig(
            tiers=[SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.1)]
        )

    from src.chatbot.repository import ChatbotRepository
    from src.chatbot.service import ChatbotService
    from src.common.database import async_session_factory

    async with async_session_factory() as session:
        repo = ChatbotRepository(session)
        service = ChatbotService(repo)
        runtime_config = await service.build_runtime_config(chatbot_id)

    if runtime_config is None:
        raise ValueError(f"chatbot_id={chatbot_id!r} 미존재 — DB 확인 필요")

    return CascadingConfig(
        tiers=[
            SearchTier(
                sources=list(t.sources),
                min_results=t.min_results,
                score_threshold=t.score_threshold,
            )
            for t in runtime_config.search.tiers
        ]
    )


async def run_search(
    query: str,
    top_k: int = 10,
    rerank_model: str = "gemini-flash",
    chatbot_id: str | None = None,
    collection_name: str | None = None,
    sources: list[str] | None = None,
) -> list[dict[str, Any]]:
    """cascading_search → (선택) reranker 적용 → 상위 top_k 결과 dict 리스트 반환.

    프로덕션 파이프라인과 동일하게 cascading 으로 top-50 후보 수집 후
    reranker 가 top_k 로 압축한다. ``rerank_model="none"`` 일 때는
    cascading 결과를 그대로 top_k 로 자른다.

    Args:
        query: 검색 질의.
        top_k: 최종 반환 결과 수.
        rerank_model: ``RERANKER_CHOICES`` 중 하나.
        chatbot_id: 지정 시 DB 의 ChatbotConfig 의 search_tiers 사용.
                    None 이면 시스템 기본 cascading config 사용.
        collection_name: Qdrant collection 명. None 이면 settings.collection_name 사용.
        sources: 명시 시 chatbot_id 무시하고 단일 SearchTier(sources=...) 사용.

    Returns:
        ``[{"volume", "chunk_index", "score", "rerank_score"}]`` 리스트.
    """
    from src.qdrant_client import get_raw_client
    from src.search.cascading import cascading_search
    from src.search.reranker import rerank as _rerank

    client = get_raw_client()
    config = await _build_eval_cascading_config(chatbot_id, sources_override=sources)

    # cascading top-K 후보 수집. Gemini Flash JSON reranker 의 prompt 길이/응답 안정성을
    # 위해 top_k * 2 (default 20) 로 제한. PR 7 fix.
    search_top_k = max(top_k * 2, 20)
    results = await cascading_search(
        client, query, config, top_k=search_top_k, collection_name=collection_name,
    )

    if rerank_model != "none" and results:
        # PR 10 cleanup: 단일 reranker (Gemini) 만 지원. rerank_model 인자는 후방
        # 호환성용 — "none" 만 reranker 비활성, 그 외 모든 값은 동일 처리.
        results = await _rerank(query, results, top_k=top_k)
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
    top_k: int = 10,
    rerank_model: str = "gemini-flash",
    chatbot_id: str | None = None,
    collection_name: str | None = None,
    sources: list[str] | None = None,
) -> dict[str, Any]:
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

        results = await run_search(
            q["query"],
            top_k=top_k,
            rerank_model=rerank_model,
            chatbot_id=chatbot_id,
            collection_name=collection_name,
            sources=sources,
        )
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
        "rerank_model": rerank_model,
        "chatbot_id": chatbot_id,
        "collection_name": collection_name,
        "sources": sources,
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
        description="Phase 0 cascade threshold + reranker A/B 평가 (judge LLM 미사용)"
    )
    parser.add_argument(
        "--golden",
        default="tests/golden/queries.json",
        help="골든셋 JSON 경로 (default: tests/golden/queries.json)",
    )
    parser.add_argument(
        "--rerank-model",
        choices=RERANKER_CHOICES,
        default="gemini-flash",
        help="reranker 모델 선택 (default: gemini-flash)",
    )
    parser.add_argument(
        "--chatbot-id",
        default=None,
        help="DB 의 ChatbotConfig.search_tiers 사용 (env EVAL_CHATBOT_ID fallback). "
             "--sources 가 명시되면 chatbot_id 무시됨.",
    )
    parser.add_argument(
        "--collection",
        default=None,
        help="Qdrant collection 명. 미지정 시 settings.collection_name (현재 malssum_poc_v5) 사용.",
    )
    parser.add_argument(
        "--sources",
        default=None,
        help="cascading source 직접 지정 (쉼표 구분, 예: 'U'). 명시 시 chatbot_id 무시. "
             "측정 컬렉션과 production search_tiers mismatch 회피용.",
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
        chatbot_id = args.chatbot_id or os.environ.get("EVAL_CHATBOT_ID") or None
        sources = (
            [s.strip() for s in args.sources.split(",") if s.strip()]
            if args.sources else None
        )
        out = asyncio.run(
            evaluate_set(
                Path(args.golden),
                rerank_model=args.rerank_model,
                chatbot_id=chatbot_id,
                collection_name=args.collection,
                sources=sources,
            )
        )

    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
