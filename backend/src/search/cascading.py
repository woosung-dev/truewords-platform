from dataclasses import dataclass, field

from qdrant_client import AsyncQdrantClient
from src.search.hybrid import hybrid_search, SearchResult


@dataclass
class SearchTier:
    """검색 우선순위 계층 설정."""
    sources: list[str]
    min_results: int = 3
    score_threshold: float = 0.75


@dataclass
class CascadingConfig:
    """Cascading Search 설정. tiers는 우선순위 순서."""
    tiers: list[SearchTier] = field(default_factory=list)


async def cascading_search(
    client: AsyncQdrantClient,
    query: str,
    config: CascadingConfig,
    top_k: int = 10,
) -> list[SearchResult]:
    """비동기 티어별 순차 검색. 충분한 결과가 모이면 중단."""
    all_results: list[SearchResult] = []

    for tier in config.tiers:
        results = await hybrid_search(
            client,
            query,
            top_k=top_k,
            source_filter=tier.sources,
        )
        qualified = [r for r in results if r.score >= tier.score_threshold]
        all_results.extend(qualified)

        if len(all_results) >= tier.min_results:
            break

    all_results.sort(key=lambda r: r.score, reverse=True)
    return all_results[:top_k]
