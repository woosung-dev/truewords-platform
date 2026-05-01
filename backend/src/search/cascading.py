"""Cascading Search — 다중 티어 순차 검색 엔진.

우선순위가 다른 데이터 소스(예: A→B→C)를 티어별로 순차 탐색하여,
min_results 이상의 결과가 확보되면 조기 종료한다.
개별 티어 실패는 격리 처리(로그 후 다음 티어 시도).
"""

import logging
from dataclasses import dataclass, field

from src.common.gemini import embed_dense_query
from src.pipeline.embedder import embed_sparse_async
from src.qdrant import RawQdrantClient
from src.search.exceptions import SearchFailedError
from src.search.hybrid import hybrid_search, SearchResult

logger = logging.getLogger(__name__)


@dataclass
class SearchTier:
    """단일 검색 티어 설정.

    Attributes:
        sources: 이 티어에서 검색할 데이터 소스 필터 (예: ``["A", "B"]``).
        min_results: 다음 티어로 넘어가지 않기 위한 최소 결과 수.
        score_threshold: RRF fusion 점수 하한 (일반적으로 0.0~0.5 범위).
    """

    sources: list[str]
    min_results: int = 3
    # RRF fusion 점수는 Σ1/(k+rank) 형태로 일반적으로 0.0~0.5 범위
    score_threshold: float = 0.1


@dataclass
class CascadingConfig:
    """Cascading Search 전체 설정.

    Attributes:
        tiers: 우선순위 순서대로 나열된 SearchTier 리스트.
               첫 번째 티어부터 검색하며, min_results 충족 시 조기 종료.
    """

    tiers: list[SearchTier] = field(default_factory=list)


async def cascading_search(
    client: RawQdrantClient,
    query: str,
    config: CascadingConfig,
    top_k: int = 10,
    dense_embedding: list[float] | None = None,
    collection_name: str | None = None,
    query_metadata: dict[str, int] | None = None,
) -> list[SearchResult]:
    """티어별 순차 검색 — 임베딩 1회 계산 후 모든 티어에서 재사용.

    각 tier의 hybrid_search 실패는 격리 처리(로그 + 다음 tier 시도).
    모든 tier가 소진된 경우에만 SearchFailedError를 raise한다.

    Args:
        client: Qdrant 비동기 클라이언트.
        query: 사용자 질의 텍스트.
        config: 티어 우선순위 및 임계값 설정.
        top_k: 최종 반환할 최대 결과 수.
        dense_embedding: 사전 계산된 dense 벡터 (None이면 내부 계산).
        query_metadata: ``extract_query_metadata`` 결과 dict. hybrid_search 로 그대로 전달.

    Returns:
        score 내림차순 정렬된 SearchResult 리스트 (최대 top_k건).

    Raises:
        SearchFailedError: 모든 티어가 예외로 실패한 경우.
    """
    # 임베딩 1회 계산 (외부 주입 시 스킵)
    dense = dense_embedding if dense_embedding is not None else await embed_dense_query(query)
    sparse = await embed_sparse_async(query)

    all_results: list[SearchResult] = []
    tier_failures = 0
    total_tiers = len(config.tiers)

    for tier_idx, tier in enumerate(config.tiers):
        try:
            results = await hybrid_search(
                client,
                query,
                top_k=top_k,
                source_filter=tier.sources,
                query_metadata=query_metadata,
                dense_embedding=dense,
                sparse_embedding=sparse,
                collection_name=collection_name,
            )
        except Exception as e:
            logger.warning(
                "Tier %d search failed (%s: %s). Trying next tier.",
                tier_idx,
                type(e).__name__,
                e,
            )
            tier_failures += 1
            continue

        qualified = [r for r in results if r.score >= tier.score_threshold]

        # Phase 0: cascade score 분포 로깅 — cutoff 정책 변경 결정 근거.
        # 자세한 배경: docs/dev-log/2026-05-01-cascade-threshold-paths.md
        if results:
            scores = [r.score for r in results]
            logger.info(
                "cascade_score_dist",
                extra={
                    "tier_idx": tier_idx,
                    "tier_sources": tier.sources,
                    "tier_threshold": tier.score_threshold,
                    "score_top": scores[0],
                    "score_p50": scores[len(scores) // 2],
                    "score_bottom": scores[-1],
                    "n_results": len(results),
                    "n_qualified": len(qualified),
                },
            )

        all_results.extend(qualified)

        if len(all_results) >= tier.min_results:
            break

    # 모든 tier가 실패한 경우에만 fatal error
    if tier_failures == total_tiers:
        raise SearchFailedError(f"All {total_tiers} search tiers failed")

    all_results.sort(key=lambda r: r.score, reverse=True)
    return all_results[:top_k]
