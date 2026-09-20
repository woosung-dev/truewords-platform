"""훈독 Pydantic 스키마 — API-HD-001·004·005·009·010 + 편성 admin API-HD-006~008 (docs/specs/api/hoondok-api.md)."""

import uuid
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field, field_validator

AuthorityGrade = Literal["O1", "O2", "O3", "O4", "O5", "R"]
ReviewStatus = Literal["reviewed", "unverified", "withdrawn"]
TodayStatus = Literal["available", "none", "withdrawn"]
MissionKind = Literal["read", "pray", "study"]  # 경로 파라미터 검증 → 알 수 없는 kind 는 422
JeongseongDuration = Literal[7, 21, 40]
JeongseongStatus = Literal["active", "completed", "abandoned"]  # DB 저장 상태
JeongseongState = Literal["upcoming", "active", "completed"]  # 오늘 기준 계산 상태(저장 안 함)


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


class MonthHistoryResponse(BaseModel):
    """API-HD-010. 해당 월의 날 수만큼 WeekDay(read 완료 기준). 미래 날은 항상 false."""

    month: str  # YYYY-MM
    days: list[WeekDay]


# --- 정성 기간 (API-HD-009) ---------------------------------------------------


class JeongseongCreate(BaseModel):
    """POST 본문. started_on 생략 시 오늘(KST), 허용 범위 오늘~오늘+30 은 service 가 422 로 검사한다."""

    topic: str = Field(min_length=1, max_length=40)
    duration_days: JeongseongDuration
    started_on: date | None = None
    reminder_time: time | None = None  # 표시용. 푸시는 Phase 4

    @field_validator("topic", mode="before")
    @classmethod
    def _strip_topic(cls, value: object) -> object:
        # 앞뒤 공백을 지운 뒤 min_length=1 이 적용되게 한다 — "   " 는 422.
        return value.strip() if isinstance(value, str) else value


class JeongseongProgress(BaseModel):
    """저장하지 않는 계산값(hoondok/jeongseong.py). missed 는 어제까지만 센다."""

    end_on: date
    done_days: int
    missed_days: int
    remaining_days: int
    percent: int
    state: JeongseongState


class JeongseongPeriodResponse(BaseModel):
    id: uuid.UUID
    topic: str
    duration_days: int
    started_on: date
    reminder_time: time | None
    status: JeongseongStatus
    progress: JeongseongProgress


class JeongseongCurrentResponse(BaseModel):
    """GET. 진행 중인 기간이 없으면(또는 끝나서 completed 로 정리됐으면) period 는 null."""

    period: JeongseongPeriodResponse | None = None


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


# --- 편성 후보 추출 (API-HD-012, PLAN-HD-003) --------------------------------
# 추출형이다: 아래 필드 중 본문(`text`)은 Qdrant 원문 그대로이고, `suggested_*` 는
# 기존 스크립트와 같은 규칙으로 만든 **제안값**이다. 생성 LLM 이 개입하지 않는다.


class DailyReadingCandidate(BaseModel):
    """편성 후보 1건. 편성자가 고르면 폼이 이 값으로 채워진다."""

    chunk_id: str
    text: str
    char_count: int
    source: str  # 코퍼스 카테고리 키 (L/M/N/O/B/P/Q 등)
    source_label: str  # 읽기 쉬운 출처 이름
    work_title: str
    suggested_title: str
    suggested_speaker: str
    score: float


class DailyReadingCandidateResponse(BaseModel):
    """API-HD-012 응답. 조건에 맞는 후보가 없으면 `candidates` 가 빈 배열이다(200)."""

    query: str
    candidates: list[DailyReadingCandidate]
