"""Semantic Cache 스키마."""

from pydantic import BaseModel


class CacheHit(BaseModel):
    """캐시 히트 결과.

    invalidation 메타데이터 (corpus_updated_at, embedding_model) 는 hit 판정 자체를
    Qdrant filter 가 처리하므로 (`SemanticCacheService.check_cache`) 별도 노출하지
    않는다. 응답에 필요한 사용자용 필드만 보존.
    """
    question: str
    answer: str
    sources: list[dict]
    score: float
    created_at: float  # Unix timestamp
