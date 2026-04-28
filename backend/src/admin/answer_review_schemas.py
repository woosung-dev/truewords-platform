"""P1-K — 운영자 검수 (AnswerReview) Pydantic 스키마.

ADR-46 P1-K. AnswerFeedback (사용자/혼합) 과 별도. 운영자 검수 라벨 + 노트.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# DB enum 과 1-1 매칭되는 Literal — 클라이언트 contract 안정성 확보.
ReviewLabelLiteral = Literal[
    "approved",
    "theological_error",
    "citation_error",
    "tone_error",
    "off_domain",
]


class AnswerReviewCreate(BaseModel):
    """POST /admin/answer-reviews body."""

    message_id: uuid.UUID
    label: ReviewLabelLiteral
    notes: str | None = Field(default=None, max_length=4000)


class AnswerReviewResponse(BaseModel):
    """단일 AnswerReview 응답."""

    id: uuid.UUID
    message_id: uuid.UUID
    reviewer_user_id: uuid.UUID
    label: ReviewLabelLiteral
    notes: str | None = None
    created_at: datetime


class ReviewQueueItem(BaseModel):
    """미검수 큐 항목 — 운영자가 다음에 검수할 메시지."""

    message_id: uuid.UUID
    session_id: uuid.UUID
    chatbot_id: uuid.UUID | None = None
    question_text: str | None = None
    answer_text: str
    answered_at: datetime
    has_negative_feedback: bool = False


class ReviewQueueResponse(BaseModel):
    items: list[ReviewQueueItem]
    total: int


class ReviewLabelCount(BaseModel):
    label: ReviewLabelLiteral
    count: int


class ReviewStatsResponse(BaseModel):
    """라벨별 카운트 + 적합/부적합 비율."""

    period_days: int
    total_reviewed: int
    approved_count: int
    rejected_count: int  # theological_error + citation_error + tone_error + off_domain
    approval_rate: float  # approved / total_reviewed (0~1)
    distribution: list[ReviewLabelCount]
