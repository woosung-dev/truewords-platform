"""훈독 DB 모델 — ENT-HD-002 daily_readings · ENT-HD-003 mission_logs · ENT-HD-004 jeongseong_periods
(docs/specs/domain/hoondok-entities.md)."""

import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import JSON, Column, Index, Text, UniqueConstraint, text
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
LOCK_SCREEN_LEVELS = ("neutral", "faith")  # 잠금화면 문구 수위 (PLAN-HD-006)


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


class ContentRight(SQLModel, table=True):
    """저작물별 신규 기능 이용 권리. 원시 volume을 식별자로 보존한다."""

    __tablename__ = "content_rights"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    volume: str = Field(max_length=512, unique=True, index=True)
    status: str = Field(default="pending", max_length=16)
    scope_search: bool = Field(default=False)
    scope_full_text: bool = Field(default=False)
    scope_jeongseong: bool = Field(default=False)
    work_title: str = Field(max_length=200)
    source_keys: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    book_series: str | None = Field(default=None, max_length=200)
    authority_grade: str = Field(default="R", max_length=8)
    note: str = Field(default="", max_length=2000)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class JeongseongReading(SQLModel, table=True):
    """KST 날짜별 추출 원문 스냅샷. 읽기 완료 기록은 기존 mission_logs를 사용한다."""

    __tablename__ = "jeongseong_readings"
    __table_args__ = (UniqueConstraint("period_id", "reading_date", name="uq_jeongseong_readings_period_date"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    period_id: uuid.UUID = Field(foreign_key="jeongseong_periods.id", index=True)
    reading_date: date
    volume: str = Field(max_length=512)
    chunk_id: str = Field(max_length=128)
    body: str = Field(sa_column=Column(Text, nullable=False))
    title: str = Field(max_length=200)
    speaker: str = Field(default="확인되지 않음", max_length=64)
    work_title: str = Field(max_length=200)
    spoken_on: str | None = Field(default=None, max_length=32)
    edition: str | None = Field(default=None, max_length=120)
    authority_grade: str = Field(default="R", max_length=8)
    review_status: str = Field(default="unverified", max_length=16)
    estimated_minutes: int = Field(default=1)
    created_at: datetime = Field(default_factory=_utcnow)


class ClientErrorEvent(SQLModel, table=True):
    """사용자 입력을 저장하지 않는 고정 오류 코드와 정규화 경로."""

    __tablename__ = "client_error_events"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    occurred_at: datetime = Field(default_factory=_utcnow)
    kind: str = Field(max_length=32)
    message: str = Field(max_length=200)
    path: str = Field(max_length=120)
    user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id", index=True)


class NotificationPreference(SQLModel, table=True):
    """ENT-HD-008 사용자별 알림 설정 1건. 행이 없으면 기본값(끔·06:00·neutral)으로 취급한다."""

    __tablename__ = "notification_preferences"

    user_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    read_enabled: bool = Field(default=False)
    read_time: time = Field(default=time(6, 0))  # KST 발송 시각(분 단위, 초는 쓰지 않는다)
    lock_screen_level: str = Field(default="neutral", max_length=16)  # LOCK_SCREEN_LEVELS
    updated_at: datetime = Field(default_factory=_utcnow)


class PushSubscription(SQLModel, table=True):
    """ENT-HD-009 브라우저 푸시 구독. endpoint 가 브라우저가 발급한 전역 식별자라 unique 다.

    한 사용자가 기기마다 여러 행을 가질 수 있고, 같은 기기를 다른 계정이 다시 구독하면 소유가 옮겨간다.
    last_sent_on·failed_count 는 발송기(sub-PR B)가 갱신한다.
    """

    __tablename__ = "push_subscriptions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    endpoint: str = Field(max_length=2048, unique=True, index=True)
    p256dh: str = Field(max_length=255)
    auth: str = Field(max_length=255)
    user_agent: str | None = Field(default=None, max_length=200)
    created_at: datetime = Field(default_factory=_utcnow)
    last_sent_on: date | None = Field(default=None)  # KST 날짜 — 하루 1회 발송 판정
    failed_count: int = Field(default=0)
