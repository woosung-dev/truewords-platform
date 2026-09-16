"""훈독 DB 모델 — ENT-HD-002 daily_readings · ENT-HD-003 mission_logs (docs/specs/domain/hoondok-entities.md)."""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Column, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    """naive UTC datetime (asyncpg 호환)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# 상태값은 Postgres ENUM 이 아니라 varchar + 앱 검증 (additive-only 규칙, 계획 §3-3).
AUTHORITY_GRADES = ("O1", "O2", "O3", "O4", "O5", "R")
REVIEW_STATUSES = ("reviewed", "unverified", "withdrawn")
MISSION_KINDS = ("read", "pray", "study")  # 훈독하기 · 기도하기 · 말씀 읽기


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
