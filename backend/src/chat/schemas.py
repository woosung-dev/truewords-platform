"""채팅 도메인 Pydantic 스키마."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from src.chat.models import FeedbackType


class ChatRequest(BaseModel):
    query: str
    chatbot_id: str | None = None
    session_id: uuid.UUID | None = None


class Source(BaseModel):
    volume: str
    text: str
    score: float
    source: str = ""


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    session_id: uuid.UUID
    message_id: uuid.UUID
    # P0-A — 자동 follow-up 추천 3개. 생성 실패/비활성 시 None.
    suggested_followups: list[str] | None = None
    # P1-J — 기도문/결의문 마무리. 비활성/생성 실패 시 None.
    closing: str | None = None


class FeedbackRequest(BaseModel):
    message_id: uuid.UUID
    feedback_type: FeedbackType
    comment: str | None = None


class FeedbackResponse(BaseModel):
    id: uuid.UUID
    message_id: uuid.UUID
    feedback_type: FeedbackType
    created_at: datetime


class SessionHistoryResponse(BaseModel):
    session_id: uuid.UUID
    messages: list[dict]
