"""훈독 Pydantic 스키마 — API-HD-001 (docs/specs/api/hoondok-api.md)."""

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel

AuthorityGrade = Literal["O1", "O2", "O3", "O4", "O5", "R"]
ReviewStatus = Literal["reviewed", "unverified", "withdrawn"]
TodayStatus = Literal["available", "none", "withdrawn"]


class DailyReadingPublic(BaseModel):
    """공개 필드만. source_note·chunk_id·타임스탬프는 내지 않는다."""

    id: uuid.UUID
    reading_date: date
    title: str
    body: str
    speaker: str
    spoken_on: str | None
    work_title: str
    edition: str | None
    authority_grade: AuthorityGrade
    review_status: ReviewStatus
    estimated_minutes: int


class TodayReadingResponse(BaseModel):
    """항상 200. 편성이 없거나 철회됐으면 status 로만 알린다 (AC-016-04)."""

    date: date
    status: TodayStatus
    reading: DailyReadingPublic | None = None
