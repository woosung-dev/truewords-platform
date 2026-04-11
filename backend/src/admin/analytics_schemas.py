"""분석 대시보드 응답 스키마."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class DashboardSummary(BaseModel):
    today_questions: int
    week_questions: int
    total_qdrant_points: int
    feedback_helpful: int
    feedback_negative: int


class DailyCount(BaseModel):
    date: str
    count: int


class SearchStats(BaseModel):
    total_searches: int
    rewrite_rate: float
    zero_result_rate: float
    avg_latency_ms: float
    fallback_none: int
    fallback_relaxed: int
    fallback_suggestions: int


class TopQuery(BaseModel):
    query_text: str
    count: int


class FeedbackDistribution(BaseModel):
    feedback_type: str
    count: int


class FeedbackSummary(BaseModel):
    distribution: list[FeedbackDistribution]


class NegativeFeedbackItem(BaseModel):
    id: uuid.UUID
    question: str
    answer_snippet: str
    feedback_type: str
    comment: str | None
    created_at: datetime
