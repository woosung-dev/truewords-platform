"""Semantic Cache 스키마."""

from pydantic import BaseModel


class CacheHit(BaseModel):
    """캐시 히트 결과."""
    question: str
    answer: str
    sources: list[dict]
    score: float
    created_at: float  # Unix timestamp
