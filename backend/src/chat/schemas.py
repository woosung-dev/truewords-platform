"""채팅 도메인 Pydantic 스키마."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from src.chat.models import FeedbackType
from src.chat.types import AnswerMode


class ChatRequest(BaseModel):
    # v3 개편: theological_emphasis 필드 제거 (2026-05-14). 기존 클라이언트가 보낼 수
    # 있으므로 extra="ignore" 로 호환. 백엔드는 강조점을 더 이상 처리하지 않는다.
    model_config = ConfigDict(extra="ignore")

    query: str
    chatbot_id: str | None = None
    session_id: uuid.UUID | None = None
    # P0-E 답변 모드 페르소나 5종 — 위급 시 pastoral 자동 라우팅 (별도 파이프라인이 처리)
    answer_mode: AnswerMode | None = None
    # 레드팀 시연 — 루트 게이트에서 입력받는 참여자 식별 정보. 세션 생성 시 1회 기록.
    participant_name: str | None = None
    participant_category: str | None = None


class Source(BaseModel):
    volume: str
    text: str
    score: float
    source: str = ""
    # P0-B — 원문보기 모달 fetch 용 Qdrant point id.
    chunk_id: str = ""
    # admin 인라인 편집으로 지정된 사람 친화적 표시명. 미설정/매칭 실패 시 None →
    # chat UI 가 기존 volume/source 로 fallback.
    display_name: str | None = None
    # [deprecated] INLINE_CITATIONS 블록 기반 phrase 하이라이트는 LLM 변형 문제로 폐기.
    # 필드 자체는 옛 semantic cache payload 후방호환 위해 유지 (캐시 TTL 만료 시 자연 정리).
    # 신규 응답에서는 항상 None.
    cited_phrase: str | None = None


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
