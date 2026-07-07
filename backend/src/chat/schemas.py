"""채팅 도메인 Pydantic 스키마."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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
    # max_length=128 은 DB VARCHAR(128) 과 동기화 — 초과 시 DB DataError(500) 대신
    # 깨끗한 422 로 거절 (클라이언트 maxLength 우회 방어).
    participant_name: str | None = Field(default=None, max_length=128)
    participant_category: str | None = Field(default=None, max_length=128)


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


class FeaturedMalssum(BaseModel):
    """레드팀 시연 — 답변 화면에 무작위로 곁들이는 큐레이션 말씀 1개.

    의미 검색이 아니라 사람이 추린 목록에서 random 선택. 매 응답마다 새로
    계산되며 캐시 payload 에는 포함하지 않는다 (항상 fresh).
    """

    text: str
    # category = 주제(테마), source = 출처 그룹(어머님 말씀/3대 경전/자서전 등), volume = 권 상세
    category: str = ""
    source: str = ""
    volume: str = ""


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    session_id: uuid.UUID
    message_id: uuid.UUID
    # 레드팀 시연 — 답변에 곁들이는 무작위 말씀 (목록 비었거나 비활성 시 None).
    featured_malssum: FeaturedMalssum | None = None
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
    # upsert 결과 — 신규 생성인지 기존 피드백 교체인지 클라이언트에 통지.
    action: Literal["created", "updated"]


class SessionHistoryResponse(BaseModel):
    session_id: uuid.UUID
    messages: list[dict]
