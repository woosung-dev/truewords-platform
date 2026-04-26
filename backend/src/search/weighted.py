"""Weighted Search — 소스별 비중 기반 병렬 검색."""

import asyncio
import logging
from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient

from src.common.gemini import embed_dense_query
from src.pipeline.embedder import embed_sparse_async
from src.search.hybrid import SearchResult, hybrid_search

logger = logging.getLogger(__name__)


@dataclass
class WeightedSource:
    """개별 소스 검색 설정.

    Attributes:
        source: 데이터 소스 라벨 (예: ``"A"``, ``"B"``).
        weight: 소스 가중치 (기본 1.0).
        score_threshold: 최소 점수 임계값 — 가중치 곱셈 전 raw score 기준 필터.
    """

    source: str
    weight: float = 1.0
    score_threshold: float = 0.1


@dataclass
class WeightedConfig:
    """Weighted Search 설정.

    Attributes:
        sources: 검색할 소스 목록과 각 소스별 설정.
    """

    sources: list[WeightedSource]


async def weighted_search(
    client: AsyncQdrantClient,
    query: str,
    config: WeightedConfig,
    top_k: int = 10,
    dense_embedding: list[float] | None = None,
    collection_name: str | None = None,
) -> list[SearchResult]:
    """소스별 가중치 기반 병렬 하이브리드 검색.

    1. 임베딩 1회 계산 (dense + sparse)
    2. 모든 소스를 asyncio.gather로 병렬 검색
    3. 각 소스별 score_threshold로 raw score 필터링 (가중치 곱셈 전)
    4. score * (weight / total_weight) 기준 정렬 (SearchResult.score는 raw RRF 유지)
    5. top_k개 반환 (0건이면 빈 리스트, 예외 없음)
    6. 개별 소스 실패 시 로그 + 스킵 (격리)

    Args:
        client: Qdrant 비동기 클라이언트.
        query: 사용자 질의 텍스트.
        config: 소스별 가중치·임계값 설정.
        top_k: 반환할 최대 결과 수.
        dense_embedding: 사전 계산된 dense 벡터 (None이면 내부 계산).

    Returns:
        가중 점수 기준 정렬된 SearchResult 리스트 (최대 top_k건).
    """
    if not config.sources:
        return []

    # 임베딩 1회 계산
    dense = dense_embedding if dense_embedding is not None else await embed_dense_query(query)
    sparse = await embed_sparse_async(query)

    # 가중치 정규화
    total_weight = sum(ws.weight for ws in config.sources)
    if total_weight <= 0:
        return []
    weight_map = {ws.source: ws.weight / total_weight for ws in config.sources}
    threshold_map = {ws.source: ws.score_threshold for ws in config.sources}

    async def _search_source(ws: WeightedSource) -> list[SearchResult]:
        """단일 소스 검색 — 실패 시 빈 리스트 반환 (격리)."""
        try:
            return await hybrid_search(
                client,
                query,
                top_k=top_k,
                source_filter=[ws.source],
                dense_embedding=dense,
                sparse_embedding=sparse,
                collection_name=collection_name,
            )
        except Exception as e:
            logger.warning(
                "Weighted search source '%s' failed (%s: %s). Skipping.",
                ws.source,
                type(e).__name__,
                e,
            )
            return []

    # 병렬 검색
    per_source_results = await asyncio.gather(
        *[_search_source(ws) for ws in config.sources]
    )

    # score_threshold 필터 + 병합
    all_results: list[SearchResult] = []
    for ws, results in zip(config.sources, per_source_results):
        threshold = threshold_map[ws.source]
        qualified = [r for r in results if r.score >= threshold]
        all_results.extend(qualified)

    # 가중 점수 기준 정렬 (raw score 유지)
    all_results.sort(
        key=lambda r: r.score * weight_map.get(r.source, 0),
        reverse=True,
    )
    return all_results[:top_k]
