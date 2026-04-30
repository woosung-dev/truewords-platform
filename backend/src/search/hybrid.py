"""Hybrid Search — Dense + Sparse RRF 융합 검색.

Qdrant의 Prefetch + FusionQuery(RRF)를 사용하여
dense(의미적 유사도)와 sparse(키워드 매칭) 결과를 융합한다.

raw httpx (HTTP/1.1) 로 Qdrant REST API 직접 호출. qdrant-client SDK 의
HTTP/2 경로가 Cloudflare Tunnel + Cloud Run 환경에서 60초 ConnectTimeout 으로
hang 하는 문제를 회피. (PR #78 진단, docs/dev-log/47 참조)
"""

from dataclasses import dataclass

from pydantic import ValidationError

from src.common.gemini import embed_dense_query
from src.config import settings
from src.pipeline.chunk_payload import QdrantChunkPayload
from src.pipeline.embedder import embed_sparse_async
from src.qdrant import QdrantPoint, RawQdrantClient
from src.qdrant.filters import (
    build_filter,
    field_match_any,
    fusion_rrf,
    prefetch as build_prefetch,
    sparse_vector,
)


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
    client: RawQdrantClient,
    query: str,
    top_k: int = 10,
    source_filter: list[str] | None = None,
    query_metadata: dict[str, int] | None = None,
    dense_embedding: list[float] | None = None,
    sparse_embedding: tuple[list[int], list[float]] | None = None,
    collection_name: str | None = None,
) -> list[SearchResult]:
    """Dense + Sparse RRF 하이브리드 검색.

    Qdrant Prefetch로 dense(50건)·sparse(50건)를 각각 검색한 뒤
    RRF(Reciprocal Rank Fusion)로 융합하여 top_k건을 반환한다.
    임베딩을 외부에서 주입하면 재계산을 스킵하여 레이턴시를 절감한다.

    Args:
        client: ``RawQdrantClient`` (raw httpx, HTTP/1.1).
        query: 사용자 질의 텍스트.
        top_k: 반환할 최대 결과 수.
        source_filter: 데이터 소스 필터 (예: ``["A", "B"]``). None이면 전체 검색.
        query_metadata: ``extract_query_metadata`` 결과 dict. 권번호 등이 추출된
            경우 source filter 와 AND 결합되어 query_filter 에 추가된다.
        dense_embedding: 사전 계산된 dense 벡터 (None이면 내부 계산).
        sparse_embedding: 사전 계산된 (indices, values) 튜플 (None이면 내부 계산).

    Returns:
        RRF 점수 기준 정렬된 SearchResult 리스트 (최대 top_k건).
    """
    from src.search.metadata_extractor import build_metadata_filter_conditions

    dense = dense_embedding if dense_embedding is not None else await embed_dense_query(query)
    if sparse_embedding is not None:
        sparse_indices, sparse_values = sparse_embedding
    else:
        sparse_indices, sparse_values = await embed_sparse_async(query)

    must_conditions: list[dict] = []
    if source_filter:
        must_conditions.append(field_match_any("source", source_filter))
    if query_metadata:
        must_conditions.extend(build_metadata_filter_conditions(query_metadata))
    query_filter = build_filter(must=must_conditions) if must_conditions else None

    points = await client.query_points(
        collection_name=collection_name or settings.collection_name,
        query=fusion_rrf(),
        prefetch=[
            build_prefetch(dense, using="dense", limit=50),
            build_prefetch(
                sparse_vector(sparse_indices, sparse_values),
                using="sparse",
                limit=50,
            ),
        ],
        query_filter=query_filter,
        limit=top_k,
    )

    return [point_to_search_result(point) for point in points]


def _normalize_source(raw: object) -> str:
    """Qdrant payload 의 source(list) 를 다운스트림용 단일 문자열로 정규화."""
    if isinstance(raw, list):
        return raw[0] if raw else ""
    if isinstance(raw, str):
        return raw
    return ""


def point_to_search_result(point: QdrantPoint) -> "SearchResult":
    """Qdrant point.payload → SearchResult 변환.

    R3 PoC: v1 (QdrantChunkPayload) 우선 파싱, 실패 시 v0 legacy dict 인덱싱
    fallback. 자연 마이그레이션 (강제 재적재 0건) 을 위함.
    """
    raw = point.payload or {}
    try:
        cp = QdrantChunkPayload.model_validate(raw)
        text = cp.text
        volume = cp.volume
        chunk_index = cp.chunk_index
        source_list: object = cp.source
    except ValidationError:
        text = raw.get("text", "")
        volume = raw.get("volume", "")
        chunk_index = raw.get("chunk_index", 0)
        source_list = raw.get("source")
    return SearchResult(
        text=text,
        volume=volume,
        chunk_index=chunk_index,
        score=point.score,
        source=_normalize_source(source_list),
    )
