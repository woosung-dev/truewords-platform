"""7일 정성 요청·응답 스키마 (읽기 정성 1a). note(남긴 한 줄)는 본인 응답에만 있다."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.modules.hoondok.journey_schemas import WordChunk

MinutesTier = Literal[3, 7, 15]
PreferredSlot = Literal["dawn", "morning", "evening"]
PathRunStatus = Literal["active", "completed", "abandoned"]
# done 읽음 · next 다음에 읽을 장 · upcoming 아직 · withdrawn 권리가 닫혀 건너뜀(완료로 세지 않음)
PathStepState = Literal["done", "next", "upcoming", "withdrawn"]
FinishAction = Literal["next", "repeat", "rest"]


class ReadingPathTier(BaseModel):
    minutes_tier: MinutesTier
    # 이 단계 장들의 하루 평균 예상 분(반올림)
    estimated_minutes: int
    total_steps: int


class ReadingPathSummary(BaseModel):
    slug: str
    title: str
    when_line: str | None
    book: str
    duration_days: int
    tiers: list[ReadingPathTier]


class ReadingPathListResponse(BaseModel):
    paths: list[ReadingPathSummary]


class PathRunStart(BaseModel):
    slug: str = Field(min_length=1, max_length=64)
    minutes_tier: MinutesTier
    preferred_slot: PreferredSlot | None = None  # 정하지 않음 = null


class PathStepSummary(BaseModel):
    day_index: int
    title: str
    estimated_minutes: int
    state: PathStepState
    # 마침표 화면이 형광펜을 장 범위로 모을 때 쓴다
    volume: str
    start_chunk_index: int
    end_chunk_index: int
    completed_on: date | None = None
    note: str | None = None  # 본인 기록


class PathRunView(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    book: str
    duration_days: int
    minutes_tier: MinutesTier
    preferred_slot: PreferredSlot | None
    status: PathRunStatus
    started_on: date
    # 서버 기준 KST 오늘 — 화면은 기기 시계 대신 이 값을 쓴다
    today: date
    # 시작일부터 오늘까지의 달력 일차(1부터). 쉰 날도 센다 — 화면 표시는 클라이언트가 고른다
    day_no: int
    end_on: date
    overdue: bool  # 오늘이 끝나는 날을 지났고 아직 진행 중
    total_steps: int
    done_steps: int
    next_step: int | None  # 다음에 읽을 day_index. 없으면 null
    read_today: bool
    # 마지막으로 읽은 날과 오늘 사이의 빈 날 수(읽은 적 없으면 시작 전날 기준). 2 이상이면 돌아온 날
    gap_days: int
    week_read_dates: list[date]  # 이번 주(월요일 시작)에 읽은 날
    read_days: int  # 읽은 날 수(전체)
    finished_at: datetime | None
    steps: list[PathStepSummary]


class PathRunCurrentResponse(BaseModel):
    """진행 중 run, 또는 마침표를 아직 보지 않은 completed run. 없으면 run=null."""

    run: PathRunView | None


class PathStepContentResponse(BaseModel):
    """장 본문. 권리가 닫혔거나 재적재로 범위가 어긋나면 status=withdrawn, chunks=[]."""

    status: Literal["available", "withdrawn"]
    day_index: int
    title: str
    estimated_minutes: int
    state: PathStepState
    volume: str
    work_title: str | None
    chunks: list[WordChunk]


class PathStepCompleteRequest(BaseModel):
    mode: Literal["full"] = "full"  # half(앞부분만)는 1b
    note: str | None = Field(default=None, max_length=200)

    @field_validator("note", mode="before")
    @classmethod
    def _strip_note(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class PathStepCompletionView(BaseModel):
    day_index: int
    mode: Literal["full", "half"]
    completed_on: date
    note: str | None


class PathStepCompleteResponse(BaseModel):
    completion: PathStepCompletionView
    run: PathRunView


class PathRunFinishRequest(BaseModel):
    action: FinishAction
    slug: str | None = Field(default=None, max_length=64)  # action=next 일 때 다음 정성
