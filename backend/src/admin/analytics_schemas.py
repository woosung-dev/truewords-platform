"""분석 대시보드 응답 스키마."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


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


class CitationItem(BaseModel):
    source: str
    volume: int
    chapter: str | None = None
    text_snippet: str
    relevance_score: float
    rank_position: int


class FeedbackItem(BaseModel):
    feedback_type: str
    comment: str | None = None
    created_at: datetime


class QueryOccurrence(BaseModel):
    search_event_id: uuid.UUID
    user_message_id: uuid.UUID
    assistant_message_id: uuid.UUID | None = None
    session_id: uuid.UUID
    chatbot_id: uuid.UUID | None = None
    chatbot_name: str | None = None
    asked_at: datetime
    rewritten_query: str | None = None
    search_tier: int
    total_results: int
    latency_ms: int
    applied_filters: dict = Field(default_factory=dict)
    answer_text: str | None = None
    citations: list[CitationItem] = Field(default_factory=list)
    feedback: FeedbackItem | None = None


class QueryDetailResponse(BaseModel):
    query_text: str
    total_count: int
    returned_count: int
    days: int
    occurrences: list[QueryOccurrence]
