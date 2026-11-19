"""공개 질문 계약 (DEC-PWA-025). 작성자 정보(user_id·이메일·이름)는 어떤 응답에도 넣지 않는다."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, WithJsonSchema, model_validator

from app.modules.chat.types import AnswerMode

PublicQuestionStatus = Literal["pending", "published", "hidden"]
ReviewStatus = Literal["published", "hidden"]


class PublicQuestionCreate(BaseModel):
    """공개 신청 본문. 질문·답은 서버가 message_id 로 복사한다 — 본문을 받지 않는다."""

    model_config = ConfigDict(extra="forbid")

    message_id: uuid.UUID


class PublicQuestionSource(BaseModel):
    """근거 말씀 한 줄 — answer_citations 복사본(상위 3건)."""

    source: str
    volume: str
    text: str


class MyPublicQuestionItem(BaseModel):
    """내 공개 신청 한 줄. 상태로 검토 중·공개됨·비공개를 보인다."""

    id: str
    message_id: uuid.UUID
    question: str
    answer_mode: AnswerMode
    status: PublicQuestionStatus
    created_at: datetime
    reviewed_at: datetime | None


class MyPublicQuestionListResponse(BaseModel):
    items: list[MyPublicQuestionItem]


class PublicQuestionSummary(BaseModel):
    """공개 목록 한 줄. preview 는 답 앞부분(마크다운 기호 제거)."""

    id: str
    question: str
    preview: str
    answer_mode: AnswerMode
    published_at: datetime
    pinned: bool  # 관리자가 고정한 질문
    view_count: int
    bookmarked: bool = False  # 로그인한 내가 담았는가(익명은 항상 false)


class PublicQuestionListResponse(BaseModel):
    """고정 질문(관리자 순서) → 인기순(조회 수 + 3 × 질문 수) → 최근 공개순. next_cursor 는 불투명 문자열이며 다음 요청의 cursor 로 보내면 이어진다(없으면 끝)."""

    items: list[PublicQuestionSummary]
    next_cursor: str | None


class PublicQuestionBookmarkListResponse(BaseModel):
    """내가 담은 공개 질문 — 최근에 담은 순, 아직 공개 중인 것만. 모든 항목이 bookmarked=true."""

    items: list[PublicQuestionSummary]


class PublicQuestionDetail(BaseModel):
    id: str
    question: str
    answer_md: str
    sources: list[PublicQuestionSource]
    answer_mode: AnswerMode
    published_at: datetime
    bookmarked: bool = False


# --- admin ---------------------------------------------------------------------


class PublicQuestionAdminItem(BaseModel):
    """검수 화면 한 줄 — 작성자 정보는 관리자에게도 보이지 않는다."""

    id: str
    question: str
    answer_md: str
    sources: list[PublicQuestionSource]
    answer_mode: AnswerMode
    status: PublicQuestionStatus
    created_at: datetime
    reviewed_at: datetime | None
    view_count: int
    ask_count: int
    score: int  # view_count + 3 × ask_count
    pin_order: int | None  # None = 고정 안 함, 작을수록 위


class PublicQuestionAdminListResponse(BaseModel):
    items: list[PublicQuestionAdminItem]
    total: int
    page: int
    page_size: int


class PublicQuestionReview(BaseModel):
    """PATCH 본문. 공개(published)·숨김(hidden) 전환과 고정(pinned) 중 하나 이상."""

    model_config = ConfigDict(extra="forbid")

    # 계약에는 null 을 넣지 않는다 — 생략만 허용한다. anyOf[enum, null] 로 바뀌면 기존 클라이언트 기준
    # enum 값 제거로 판정된다(oasdiff). 보내지 않으면 None 이다.
    status: Annotated[ReviewStatus | None, WithJsonSchema({"type": "string", "enum": ["published", "hidden"]})] = None
    pinned: Annotated[bool | None, WithJsonSchema({"type": "boolean"})] = None

    @model_validator(mode="after")
    def _require_one(self) -> "PublicQuestionReview":
        if self.status is None and self.pinned is None:
            raise ValueError("status 또는 pinned 가 필요합니다")
        return self


class PublicQuestionPinsResponse(BaseModel):
    """고정 질문 목록 — pin_order 순."""

    items: list[PublicQuestionAdminItem]


class PublicQuestionPinsReorder(BaseModel):
    """PUT /pins 본문 — 현재 고정된 질문 전체를 새 순서로(앞이 위)."""

    model_config = ConfigDict(extra="forbid")

    ids: list[str] = Field(max_length=10)
