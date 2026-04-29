"""Fallback Search — 검색 결과 0건 시 두 단계 fallback.

1단계(relaxed): source 필터 제거 후 전체 컬렉션 재검색.
2단계(suggestions): LLM에 관련 질문 3개 제안 요청.

raw httpx (HTTP/1.1) 로 Qdrant REST API 직접 호출. (PR #78 진단,
docs/dev-log/47 참조)
"""

import json
import logging
from typing import Literal

from src.common.gemini import generate_text, MODEL_GENERATE
from src.config import settings
from src.pipeline.embedder import embed_sparse_async
from src.qdrant import RawQdrantClient
from src.qdrant.filters import (
    fusion_rrf,
    prefetch as build_prefetch,
    sparse_vector,
)
from src.search.hybrid import SearchResult, point_to_search_result

logger = logging.getLogger(__name__)

FallbackType = Literal["none", "relaxed", "suggestions"]

SUGGEST_SYSTEM_PROMPT = """당신은 가정연합 말씀 검색 도우미입니다.
사용자가 검색했지만 결과를 찾지 못했습니다.
사용자의 원래 질문을 참고하여, 말씀 데이터베이스에서 찾을 수 있을 만한 관련 질문 3개를 제안하세요.

[규칙]
1. 가정연합 말씀 범위 내의 질문만 제안하세요.
2. 원본 질문과 관련된 다른 관점의 질문을 제안하세요.
3. JSON 배열만 반환하세요: ["질문1", "질문2", "질문3"]"""


async def fallback_search(
    client: RawQdrantClient,
    query: str,
    original_results: list[SearchResult],
    dense_embedding: list[float],
    sparse_embedding: tuple[list[int], list[float]] | None = None,
    top_k: int = 10,
    score_threshold: float = 0.05,
    collection_name: str | None = None,
) -> tuple[list[SearchResult], FallbackType]:
    """검색 결과 0건 시 두 단계 fallback.

    원본 결과가 존재하면 즉시 반환(fallback_type="none").
    0건이면 source 필터 없이 전체 컬렉션을 재검색(fallback_type="relaxed").
    relaxed도 0건이면 LLM에 관련 질문 3개를 제안(fallback_type="suggestions").

    Args:
        client: ``RawQdrantClient`` (raw httpx, HTTP/1.1).
        query: 사용자 질의 텍스트.
        original_results: 상위 검색 단계(cascading_search)의 결과 리스트.
        dense_embedding: 사전 계산된 dense 벡터.
        sparse_embedding: 사전 계산된 (indices, values) 튜플 (None이면 내부 계산).
        top_k: 반환할 최대 결과 수.
        score_threshold: 이 점수 미만의 결과는 제외한다.

    Returns:
        (결과 리스트, fallback 유형) 튜플.
    """
    # 원본 결과가 있으면 fallback 불필요
    if original_results:
        return original_results, "none"

    # 1단계: source 필터 제거 후 전체 재검색
    logger.info("Fallback Step 1: relaxed search for query: '%s'", query)

    if sparse_embedding is not None:
        sparse_indices, sparse_values = sparse_embedding
    else:
        sparse_indices, sparse_values = await embed_sparse_async(query)

    points = await client.query_points(
        collection_name=collection_name or settings.collection_name,
        query=fusion_rrf(),
        prefetch=[
            build_prefetch(dense_embedding, using="dense", limit=50),
            build_prefetch(
                sparse_vector(sparse_indices, sparse_values),
                using="sparse",
                limit=50,
            ),
        ],
        query_filter=None,
        limit=top_k,
    )

    relaxed_results = [
        point_to_search_result(point)
        for point in points
        if point.score >= score_threshold
    ]

    if relaxed_results:
        logger.info("Fallback Step 1 found %d results", len(relaxed_results))
        return relaxed_results, "relaxed"

    # 2단계: LLM 질문 제안
    logger.info("Fallback Step 2: generating suggestions for query: '%s'", query)
    await _generate_suggestions(query)
    return [], "suggestions"


async def _generate_suggestions(query: str) -> list[str]:
    """LLM에 관련 질문 3개를 제안받는다.

    LLM 호출 실패 시 빈 리스트를 반환하여 graceful degradation을 보장한다.

    Args:
        query: 사용자 원래 질문 텍스트.

    Returns:
        제안 질문 문자열 리스트 (최대 3개). 실패 시 빈 리스트.
    """
    try:
        response = await generate_text(
            prompt=f"사용자 질문: {query}",
            system_instruction=SUGGEST_SYSTEM_PROMPT,
            model=MODEL_GENERATE,
        )
        suggestions = json.loads(response.strip())
        if isinstance(suggestions, list):
            return [s for s in suggestions[:3] if isinstance(s, str)]
    except Exception as e:
        logger.warning("Failed to generate suggestions (%s: %s)", type(e).__name__, e)
    return []
