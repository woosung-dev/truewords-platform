"""Hybrid Search — Dense + Sparse RRF 융합 검색.

Qdrant의 Prefetch + FusionQuery(RRF)를 사용하여
dense(의미적 유사도)와 sparse(키워드 매칭) 결과를 융합한다.
"""

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
    """검색 결과 단일 항목.

    Attributes:
        text: 청크 원문 텍스트.
        volume: 원본 문서 권호 식별자 (예: ``"001"``).
        chunk_index: 문서 내 청크 순번.
        score: RRF fusion 점수 (일반적으로 0.0~0.5 범위).
        source: 데이터 소스 라벨 (예: ``"A"``, ``"L"``).
        rerank_score: Re-ranking 후 점수 (미적용 시 None).
    """

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
    """Dense + Sparse RRF 하이브리드 검색.

    Qdrant Prefetch로 dense(50건)·sparse(50건)를 각각 검색한 뒤
    RRF(Reciprocal Rank Fusion)로 융합하여 top_k건을 반환한다.
    임베딩을 외부에서 주입하면 재계산을 스킵하여 레이턴시를 절감한다.

    Args:
        client: Qdrant 비동기 클라이언트.
        query: 사용자 질의 텍스트.
        top_k: 반환할 최대 결과 수.
        source_filter: 데이터 소스 필터 (예: ``["A", "B"]``). None이면 전체 검색.
        dense_embedding: 사전 계산된 dense 벡터 (None이면 내부 계산).
        sparse_embedding: 사전 계산된 (indices, values) 튜플 (None이면 내부 계산).

    Returns:
        RRF 점수 기준 정렬된 SearchResult 리스트 (최대 top_k건).
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
