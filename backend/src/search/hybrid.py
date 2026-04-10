from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Prefetch,
    FusionQuery,
    Fusion,
    SparseVector,
    Filter,
    FieldCondition,
    MatchAny,
)
from src.common.gemini import embed_dense_query
from src.pipeline.embedder import embed_sparse_async
from src.config import settings


@dataclass
class SearchResult:
    text: str
    volume: str
    chunk_index: int
    score: float
    source: str = ""
    rerank_score: float | None = None


async def hybrid_search(
    client: AsyncQdrantClient,
    query: str,
    top_k: int = 10,
    source_filter: list[str] | None = None,
    dense_embedding: list[float] | None = None,
    sparse_embedding: tuple[list[int], list[float]] | None = None,
) -> list[SearchResult]:
    """비동기 하이브리드 검색 (dense + sparse RRF).

    임베딩을 외부에서 주입하면 재계산을 스킵하여 레이턴시 절감.
    """
    dense = dense_embedding if dense_embedding is not None else await embed_dense_query(query)
    if sparse_embedding is not None:
        sparse_indices, sparse_values = sparse_embedding
    else:
        sparse_indices, sparse_values = await embed_sparse_async(query)

    query_filter = None
    if source_filter:
        query_filter = Filter(
            must=[FieldCondition(key="source", match=MatchAny(any=source_filter))]
        )

    response = await client.query_points(
        collection_name=settings.collection_name,
        prefetch=[
            Prefetch(query=dense, using="dense", limit=50),
            Prefetch(
                query=SparseVector(
                    indices=sparse_indices,
                    values=sparse_values,
                ),
                using="sparse",
                limit=50,
            ),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        query_filter=query_filter,
        limit=top_k,
    )

    def _extract_source(payload: dict) -> str:
        # Qdrant payload의 source는 ["L"] 같은 리스트로 저장되어 있지만
        # 다운스트림(DB VARCHAR, 응답 스키마)은 단일 문자열을 기대하므로 여기서 정규화한다.
        raw = payload.get("source")
        if isinstance(raw, list):
            return raw[0] if raw else ""
        return raw or ""

    return [
        SearchResult(
            text=point.payload["text"],
            volume=point.payload["volume"],
            chunk_index=point.payload.get("chunk_index", 0),
            score=point.score,
            source=_extract_source(point.payload),
        )
        for point in response.points
    ]
