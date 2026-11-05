"""훈독 AI 질문 계약 (DEC-PWA-025 2차) — 로그인 필수, 계정에만 보관, 하루 횟수."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.chat.schemas import Source
from app.modules.chat.types import AnswerMode
from app.modules.hoondok.public_questions_schemas import PublicQuestionStatus


class AskRequest(BaseModel):
    """질문 1건. /chat/stream 과 같은 필드에서 봇(chatbot_id)은 서버가 정한다.

    길이(1000자)·빈 질문은 기존 입력 검증이 400 INPUT_BLOCKED 로 거절한다(설정값과 한곳에서 맞추려고 여기서 막지 않는다).
    """

    model_config = ConfigDict(extra="ignore")

    query: str
    # 있으면 이어 묻기. 내 대화가 아니면(남의 것·시연 챗 세션·없는 id) 403 SESSION_FORBIDDEN.
    session_id: uuid.UUID | None = None
    # 없으면 자동 — 서버가 질문을 보고 고른다.
    answer_mode: AnswerMode | None = None


class AskQuota(BaseModel):
    """오늘(KST) 남은 질문 횟수. resets_at 은 다음 KST 자정(+09:00)."""

    limit: int
    used: int
    remaining: int
    resets_at: datetime


class MyAskSummary(BaseModel):
    """내 대화 목록 한 줄. id 는 session_id(이어 묻기에 그대로 보낸다)."""

    id: uuid.UUID
    question: str  # 첫 질문
    answer_mode: AnswerMode  # 첫 답에 실제 적용된 모드 — 같은 질문을 다른 모드로 다시 물은 항목을 구분한다
    turn_count: int  # 답 개수
    saved: bool
    # 첫 답의 공개 신청(이어 물은 답은 공개 대상이 아니다). 신청하지 않았으면 둘 다 null.
    public_id: str | None
    public_status: PublicQuestionStatus | None
    created_at: datetime
    last_at: datetime


class MyAskListResponse(BaseModel):
    """최근 활동순."""

    items: list[MyAskSummary]


class MyAskTurn(BaseModel):
    """질문 → 답 한 차례. sources 는 처음 받은 sources 이벤트와 같은 모양(chunk_id 로 원문을 연다)."""

    message_id: uuid.UUID  # 답 메시지 id — 공개 신청(POST /hoondok/me/questions)에 쓴다
    question: str
    answer_md: str
    answer_mode: AnswerMode
    sources: list[Source]
    suggested_followups: list[str]
    public_id: str | None
    public_status: PublicQuestionStatus | None
    created_at: datetime


class MyAskDetail(BaseModel):
    id: uuid.UUID
    saved: bool
    created_at: datetime
    turns: list[MyAskTurn]


class MyAskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    saved: bool
