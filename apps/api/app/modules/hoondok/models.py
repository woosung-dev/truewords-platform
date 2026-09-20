"""훈독 DB 모델 — ENT-HD-002 daily_readings · ENT-HD-003 mission_logs · ENT-HD-004 jeongseong_periods
(docs/specs/domain/hoondok-entities.md)."""

import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import Column, Index, Text, UniqueConstraint, text
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    """naive UTC datetime (asyncpg 호환)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# 상태값은 Postgres ENUM 이 아니라 varchar + 앱 검증 (additive-only 규칙, 계획 §3-3).
AUTHORITY_GRADES = ("O1", "O2", "O3", "O4", "O5", "R")
REVIEW_STATUSES = ("reviewed", "unverified", "withdrawn")
MISSION_KINDS = ("read", "pray", "study")  # 훈독하기 · 기도하기 · 말씀 읽기
JEONGSEONG_STATUSES = ("active", "completed", "abandoned")
JEONGSEONG_DURATIONS = (7, 21, 40)  # 앱 검증(Literal). DB CHECK 는 두지 않는다


class DailyReading(SQLModel, table=True):
    """오늘 말씀 편성 1일 1건. 운영자 수기 입력(결정 5), 시드는 로컬·E2E 한정(결정 6)."""

    __tablename__ = "daily_readings"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    reading_date: date = Field(unique=True, index=True)  # KST
    title: str = Field(max_length=200)
    body: str = Field(sa_column=Column(Text, nullable=False))
    # AC-016-01 메타 6항목: 화자·날짜·저작물·판본·공식성·검수
    speaker: str = Field(max_length=64)
    spoken_on: str | None = Field(default=None, max_length=32)
    work_title: str = Field(max_length=200)
    edition: str | None = Field(default=None, max_length=120)
    authority_grade: str = Field(max_length=8)  # O1~O5 / R
    review_status: str = Field(default="unverified", max_length=16)
    source_note: str | None = Field(default=None, max_length=500)
    chunk_id: str | None = Field(default=None, max_length=128)  # Qdrant point id, FK 아님
    estimated_minutes: int = Field(default=3)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class MissionLog(SQLModel, table=True):
    """미션 완료 기록. 하루 1회(user·date·kind unique, AC-016-02). 연속일은 저장하지 않고 계산한다."""

    __tablename__ = "mission_logs"
    __table_args__ = (
        UniqueConstraint("user_id", "mission_date", "kind", name="uq_mission_logs_user_date_kind"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    mission_date: date  # 완료 판정일(KST). 서버가 today_kst() 로 정한다
    kind: str = Field(max_length=16)  # MISSION_KINDS
    completed_at: datetime = Field(default_factory=_utcnow)  # 실제 완료 시각(UTC)


class JeongseongPeriod(SQLModel, table=True):
    """정성 기간(7·21·40일). 사용자당 active 1건 — 부분 unique 인덱스(status='active')가 지킨다.

    진행률(done·missed·percent)은 저장하지 않고 mission_logs 의 read 완료일에서 매번 계산한다(hoondok/jeongseong.py).
    reminder_time 은 표시용이며 푸시는 Phase 4 다.
    """

    __tablename__ = "jeongseong_periods"
    __table_args__ = (
        Index(
            "uq_jeongseong_periods_user_active",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),  # aiosqlite 테스트에서도 같은 제약을 재현한다
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    topic: str = Field(max_length=40)
    duration_days: int  # JEONGSEONG_DURATIONS
    started_on: date  # KST
    reminder_time: time | None = Field(default=None)
    status: str = Field(default="active", max_length=16, sa_column_kwargs={"server_default": "active"})
    ended_at: datetime | None = Field(default=None)  # completed·abandoned 로 바뀐 시각(UTC)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
