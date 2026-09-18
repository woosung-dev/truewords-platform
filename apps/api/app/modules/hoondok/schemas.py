"""훈독 Pydantic 스키마 — API-HD-001·004·005 + 편성 admin API-HD-006~008 (docs/specs/api/hoondok-api.md)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

AuthorityGrade = Literal["O1", "O2", "O3", "O4", "O5", "R"]
ReviewStatus = Literal["reviewed", "unverified", "withdrawn"]
TodayStatus = Literal["available", "none", "withdrawn"]
MissionKind = Literal["read", "pray", "study"]  # 경로 파라미터 검증 → 알 수 없는 kind 는 422


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


class MissionCompleteResponse(BaseModel):
    """API-HD-005 201. mission_date 는 서버가 KST 로 정한 날짜다."""

    mission_date: date
    kind: MissionKind
    completed_at: datetime


class TodayFlags(BaseModel):
    read: bool = False
    pray: bool = False
    study: bool = False


class WeekDay(BaseModel):
    date: date
    done: bool


class SummaryResponse(BaseModel):
    """API-HD-004. 연속일·최대·누적은 read 기준이며 저장하지 않는다. week 는 월요일 시작 7칸."""

    today: TodayFlags
    streak_days: int
    best_streak_days: int
    total_days: int
    week: list[WeekDay]


# --- 편성 admin (API-HD-006~008, Phase 3 A) ---------------------------------
# 상태값은 Literal 로만 검증한다 — DB 는 varchar (additive-only, 계획 §3-3).


class DailyReadingAdminCreate(BaseModel):
    """POST 본문. ENT-HD-002 전 컬럼(id·타임스탬프 제외). 하루 1건은 unique 가 지킨다(409)."""

    reading_date: date
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1)
    speaker: str = Field(min_length=1, max_length=64)
    spoken_on: str | None = Field(default=None, max_length=32)
    work_title: str = Field(min_length=1, max_length=200)
    edition: str | None = Field(default=None, max_length=120)
    authority_grade: AuthorityGrade
    review_status: ReviewStatus = "unverified"
    source_note: str | None = Field(default=None, max_length=500)
    chunk_id: str | None = Field(default=None, max_length=128)
    estimated_minutes: int = Field(default=3, ge=1, le=60)


class DailyReadingAdminUpdate(BaseModel):
    """PUT 본문. 보낸 필드만 바꾼다(exclude_unset). `review_status=withdrawn` 이 철회 수단이며 DELETE 는 없다."""

    reading_date: date | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, min_length=1)
    speaker: str | None = Field(default=None, min_length=1, max_length=64)
    spoken_on: str | None = Field(default=None, max_length=32)
    work_title: str | None = Field(default=None, min_length=1, max_length=200)
    edition: str | None = Field(default=None, max_length=120)
    authority_grade: AuthorityGrade | None = None
    review_status: ReviewStatus | None = None
    source_note: str | None = Field(default=None, max_length=500)
    chunk_id: str | None = Field(default=None, max_length=128)
    estimated_minutes: int | None = Field(default=None, ge=1, le=60)


class DailyReadingAdminResponse(BaseModel):
    """관리자 응답 — 공개 스키마와 달리 source_note·chunk_id·타임스탬프를 포함한다."""

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
    source_note: str | None
    chunk_id: str | None
    estimated_minutes: int
    created_at: datetime
    updated_at: datetime
