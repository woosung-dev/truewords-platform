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
    session_id: uuid.UUID
    chatbot_name: str | None = None
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
    user_message_id: uuid.UUID | None = None
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


class QueryListItem(BaseModel):
    query_text: str
    count: int
    latest_at: datetime
    negative_feedback_count: int


class QueryListResponse(BaseModel):
    items: list[QueryListItem]
    total: int
    page: int
    size: int
    days: int


class ReactionCount(BaseModel):
    kind: str
    count: int


class SessionMessageItem(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    created_at: datetime
    resolved_answer_mode: str | None = None
    persona_overridden: bool | None = None
    reactions: list[ReactionCount] = Field(default_factory=list)
    feedback: FeedbackItem | None = None
    citations: list[CitationItem] = Field(default_factory=list)


class SessionDetailResponse(BaseModel):
    session_id: uuid.UUID
    chatbot_id: uuid.UUID | None = None
    chatbot_name: str | None = None
    started_at: datetime
    ended_at: datetime | None = None
    messages: list[SessionMessageItem] = Field(default_factory=list)
