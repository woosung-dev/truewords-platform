"""훈독 Pydantic 스키마 — API-HD-001·004·005 (docs/specs/api/hoondok-api.md)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

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
