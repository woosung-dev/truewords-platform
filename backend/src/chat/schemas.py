"""채팅 도메인 Pydantic 스키마."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from src.chat.models import FeedbackType
from src.chat.types import AnswerMode, MessageVisibility, TheologicalEmphasis


class ChatRequest(BaseModel):
    query: str
    chatbot_id: str | None = None
    session_id: uuid.UUID | None = None
    # P0-E 답변 모드 페르소나 5종 — 위급 시 pastoral 자동 라우팅 (별도 파이프라인이 처리)
    answer_mode: AnswerMode | None = None
    # P1-G 신학 강조점 토글 — runtime_config 의 system prompt 추가절(節) 분기
    theological_emphasis: TheologicalEmphasis | None = None
    # P2-D 공개/비공개 — chat_message.visibility 와 매핑
    visibility: MessageVisibility | None = None


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
