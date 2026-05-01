"""채팅 도메인 Pydantic 스키마."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from src.chat.models import FeedbackType
from src.chat.types import AnswerMode, TheologicalEmphasis


class ChatRequest(BaseModel):
    query: str
    chatbot_id: str | None = None
    session_id: uuid.UUID | None = None
    # P0-E 답변 모드 페르소나 5종 — 위급 시 pastoral 자동 라우팅 (별도 파이프라인이 처리)
    answer_mode: AnswerMode | None = None
    # P1-G 신학 강조점 토글 — runtime_config 의 system prompt 추가절(節) 분기
    theological_emphasis: TheologicalEmphasis | None = None


class Source(BaseModel):
    volume: str
    text: str
    score: float
    source: str = ""
    # P0-B — 원문보기 모달 fetch 용 Qdrant point id.
    chunk_id: str = ""


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    session_id: uuid.UUID
    message_id: uuid.UUID
    # P0-A — 자동 follow-up 추천 3개. 생성 실패/비활성 시 None.
    suggested_followups: list[str] | None = None
    # P1-J — 기도문/결의문 마무리. 비활성/생성 실패 시 None.
    closing: str | None = None
    # B5 — 사용자 명시 페르소나가 위기 신호로 pastoral 강제 override 됐는지.
    # True 면 UI 가 "위기 신호로 감지되어 상담 모드로 전환됐어요" 노티 노출.
    persona_overridden: bool = False


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
