from dataclasses import dataclass, field

from qdrant_client import AsyncQdrantClient
from src.common.gemini import embed_dense_query
from src.pipeline.embedder import embed_sparse_async
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
    dense_embedding: list[float] | None = None,
) -> list[SearchResult]:
    """비동기 티어별 순차 검색. 임베딩을 1회만 계산하여 모든 티어에서 재사용."""
    # 임베딩 1회 계산 (외부 주입 시 스킵)
    dense = dense_embedding if dense_embedding is not None else await embed_dense_query(query)
    sparse = await embed_sparse_async(query)

    all_results: list[SearchResult] = []

    for tier in config.tiers:
        results = await hybrid_search(
            client,
            query,
            top_k=top_k,
            source_filter=tier.sources,
            dense_embedding=dense,
            sparse_embedding=sparse,
        )
        qualified = [r for r in results if r.score >= tier.score_threshold]
        all_results.extend(qualified)

        if len(all_results) >= tier.min_results:
            break

    all_results.sort(key=lambda r: r.score, reverse=True)
    return all_results[:top_k]
