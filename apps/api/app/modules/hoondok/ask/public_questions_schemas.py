"""공개 질문 계약 (DEC-PWA-025). 작성자 정보(user_id·이메일·이름)는 어떤 응답에도 넣지 않는다."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

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


class PublicQuestionListResponse(BaseModel):
    """최신순. next_cursor 를 다음 요청의 cursor 로 보내면 이어진다(없으면 끝)."""

    items: list[PublicQuestionSummary]
    next_cursor: str | None


class PublicQuestionDetail(BaseModel):
    id: str
    question: str
    answer_md: str
    sources: list[PublicQuestionSource]
    answer_mode: AnswerMode
    published_at: datetime


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


class PublicQuestionAdminListResponse(BaseModel):
    items: list[PublicQuestionAdminItem]
    total: int
    page: int
    page_size: int


class PublicQuestionReview(BaseModel):
    """PATCH 본문. 공개(published) 또는 숨김(hidden)만 받는다."""

    model_config = ConfigDict(extra="forbid")

    status: ReviewStatus
