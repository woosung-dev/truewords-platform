"""오늘의 책갈피 계약 (API-HD-047~052, PLAN-HD-012). 상태값은 DB ENUM 없이 Literal 로 검증한다."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CardStatus = Literal["draft", "active", "retired"]
CardFilter = Literal["shared"]


class CardPublic(BaseModel):
    """공개 카드 1장. `volume`·`chunk_id`·`chunk_index` 로 서고 원문(`/hoondok/words/{volume}?chunk_id=`)에 잇는다."""

    id: uuid.UUID
    text: str
    volume: str
    chunk_id: str
    chunk_index: int
    work_title: str
    source_label: str
    topic: str | None


class TodayCardResponse(BaseModel):
    """API-HD-047. 풀이 비었으면 card=null — `/hoondok/today` 처럼 항상 200 이다."""

    date: date
    card: CardPublic | None


class CardReceiptItem(BaseModel):
    """API-HD-049·050 응답이자 051 목록의 한 줄."""

    card: CardPublic
    received_on: date
    shared_at: datetime | None


class CardShelf(BaseModel):
    """책장 한 칸 — 책(`work_title`)별 개수."""

    work_title: str
    count: int


class MyCardsResponse(BaseModel):
    """API-HD-051. shelves 는 개수 내림차순(동률은 책 이름순), items 는 받은 날 최신순."""

    shelves: list[CardShelf]
    items: list[CardReceiptItem]


# --- API-HD-052 admin --------------------------------------------------------


class CardAdminCreate(BaseModel):
    """POST 본문. 본문(`text`)은 원문 그대로 — 등록 뒤에는 바꿀 수 없다."""

    text: str = Field(min_length=1, max_length=2000)
    volume: str = Field(min_length=1, max_length=512)
    chunk_id: str = Field(min_length=1, max_length=128)
    chunk_index: int = Field(ge=0)
    work_title: str = Field(min_length=1, max_length=200)
    source_label: str = Field(min_length=1, max_length=300)
    topic: str | None = Field(default=None, max_length=200)
    status: CardStatus = "draft"
    pinned_on: date | None = None


class CardAdminUpdate(BaseModel):
    """PATCH 본문. 보낸 필드만 바꾼다(`pinned_on: null` 은 고정 해제). 그 밖의 필드(`text` 포함)는 422."""

    model_config = ConfigDict(extra="forbid")

    status: CardStatus | None = None
    pinned_on: date | None = None


class CardAdminItem(CardPublic):
    status: CardStatus
    pinned_on: date | None
    created_at: datetime


class CardAdminListResponse(BaseModel):
    items: list[CardAdminItem]
    total: int
    page: int
    page_size: int
