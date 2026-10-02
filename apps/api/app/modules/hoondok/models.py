"""훈독 DB 모델 — ENT-HD-002 daily_readings · ENT-HD-003 mission_logs · ENT-HD-004 jeongseong_periods ·
ENT-HD-013~017 함께 읽는 모임 · ENT-HD-019·020 오늘의 책갈피 (docs/specs/domain/hoondok-entities.md)."""

import uuid
from datetime import date, datetime, time

from sqlalchemy import JSON, Column, Index, Text, UniqueConstraint, text
from sqlmodel import Field, SQLModel

from app.core.common.clock import utcnow


# 상태값은 Postgres ENUM 이 아니라 varchar + 앱 검증 (additive-only 규칙, 계획 §3-3).
AUTHORITY_GRADES = ("O1", "O2", "O3", "O4", "O5", "R")
REVIEW_STATUSES = ("reviewed", "unverified", "withdrawn")
MISSION_KINDS = ("read", "pray", "study")  # 훈독하기 · 기도하기 · 말씀 읽기
JEONGSEONG_STATUSES = ("active", "completed", "abandoned")
JEONGSEONG_DURATIONS = (7, 21, 40)  # 앱 검증(Literal). DB CHECK 는 두지 않는다
SECTION_LEVELS = (1, 2)  # 1 = 편·장, 2 = 장·절·설교 (PLAN-HD-007)
SECTION_ORIGINS = ("auto", "manual")  # 추출 스크립트 산출 / 운영자 수기
MARK_KINDS = ("bookmark", "highlight")
GROUP_KINDS = ("small_group",)  # 가족 모임은 후속 (PLAN-HD-010)
GROUP_ROLES = ("leader", "member")
CARD_STATUSES = ("draft", "active", "retired")  # 오늘의 책갈피 풀 상태 (PLAN-HD-012)


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
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class MissionLog(SQLModel, table=True):
    """미션 완료 기록. 하루 1회(user·date·kind unique, AC-016-02). 연속일은 저장하지 않고 계산한다."""

    __tablename__ = "mission_logs"
    __table_args__ = (
        UniqueConstraint("user_id", "mission_date", "kind", name="uq_mission_logs_user_date_kind"),
        # "함께 읽는 사람들"(API-HD-029) 하루 집계 — unique 는 user_id 가 선두라 날짜 조건에 못 쓴다.
        Index("ix_mission_logs_date_kind", "mission_date", "kind"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    mission_date: date  # 완료 판정일(KST). 서버가 today_kst() 로 정한다
    kind: str = Field(max_length=16)  # MISSION_KINDS
    completed_at: datetime = Field(default_factory=utcnow)  # 실제 완료 시각(UTC)


class JeongseongPeriod(SQLModel, table=True):
    """정성 기간(7·21·40일). 사용자당 active 1건 — 부분 unique 인덱스(status='active')가 지킨다.

    진행률(done·missed·percent)은 저장하지 않고 mission_logs 의 read 완료일에서 매번 계산한다(hoondok/jeongseong.py).
    reminder_time 은 사용 중단 — 알림 시각은 notification_preferences.read_time.
    resolution(나의 각오)은 본인 응답에만 담는다 — 모임·가족·관리자 응답에 넣지 않는다.
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
    resolution: str | None = Field(default=None, max_length=50)  # 선택. 앞뒤 공백 제거, 빈 값은 NULL
    duration_days: int  # JEONGSEONG_DURATIONS
    started_on: date  # KST
    reminder_time: time | None = Field(default=None)
    status: str = Field(default="active", max_length=16, sa_column_kwargs={"server_default": "active"})
    ended_at: datetime | None = Field(default=None)  # completed·abandoned 로 바뀐 시각(UTC)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


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
    # Qdrant 청크 수. 시드 스크립트(트랙 D)가 채우며 미집계면 None 이다.
    chunk_count: int | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


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
    created_at: datetime = Field(default_factory=utcnow)


class ClientErrorEvent(SQLModel, table=True):
    """사용자 입력을 저장하지 않는 고정 오류 코드와 정규화 경로."""

    __tablename__ = "client_error_events"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    occurred_at: datetime = Field(default_factory=utcnow)
    kind: str = Field(max_length=32)
    message: str = Field(max_length=200)
    path: str = Field(max_length=120)
    user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id", index=True)


class NotificationPreference(SQLModel, table=True):
    """ENT-HD-008 사용자별 알림 설정 1건. 행이 없으면 기본값(끔·06:00)으로 취급한다."""

    __tablename__ = "notification_preferences"

    user_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    read_enabled: bool = Field(default=False)
    read_time: time = Field(default=time(6, 0))  # KST 발송 시각(분 단위, 초는 쓰지 않는다)
    updated_at: datetime = Field(default_factory=utcnow)


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
    created_at: datetime = Field(default_factory=utcnow)
    last_sent_on: date | None = Field(default=None)  # KST 날짜 — 하루 1회 발송 판정
    failed_count: int = Field(default=0)


class VolumeSection(SQLModel, table=True):
    """ENT-HD-010 권 안의 장 목차. 본문 규칙 추출이 만들고 운영자 수기 행과 공존한다 (PLAN-HD-007).

    `origin='auto'` 행은 추출 스크립트가 권 단위로 전량 교체하고 `manual` 행은 보존한다
    (LibraryRepository.replace_auto_sections). 본문 자체는 Qdrant 에만 있고 여기에는 경계만 둔다.
    """

    __tablename__ = "volume_sections"
    __table_args__ = (
        UniqueConstraint("volume", "position", name="uq_volume_sections_volume_position"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    volume: str = Field(max_length=512, index=True)  # Qdrant payload 원문 그대로
    position: int  # 권 안의 표시 순서(1부터)
    level: int  # SECTION_LEVELS — 1 편·장, 2 장·절·설교
    title: str = Field(max_length=200)
    start_chunk_index: int
    end_chunk_index: int
    spoken_on: str | None = Field(default=None, max_length=32)  # 말씀 날짜 서명
    place: str | None = Field(default=None, max_length=120)
    origin: str = Field(default="auto", max_length=16, sa_column_kwargs={"server_default": "auto"})
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class ReadingPosition(SQLModel, table=True):
    """ENT-HD-011 사용자·권별 이어 읽기 위치 1건. 단위는 Qdrant 청크(계획 §2-12)."""

    __tablename__ = "reading_positions"
    __table_args__ = (
        UniqueConstraint("user_id", "volume", name="uq_reading_positions_user_volume"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    volume: str = Field(max_length=512)
    chunk_index: int
    updated_at: datetime = Field(default_factory=utcnow)


class PassageMark(SQLModel, table=True):
    """ENT-HD-012 단락 표시 — 단위는 청크다. `(user_id, chunk_id, kind)` 가 unique 다.

    형광펜·메모는 구절 단위(ENT-HD-021 `passage_highlights`)로 옮겨 이제 `bookmark` 만 쓴다.
    예전 `kind="highlight"` 행은 지우지 않고 남겨 두되 API 는 읽지 않는다.
    """

    __tablename__ = "passage_marks"
    __table_args__ = (
        UniqueConstraint("user_id", "chunk_id", "kind", name="uq_passage_marks_user_chunk_kind"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    volume: str = Field(max_length=512)
    chunk_id: str = Field(max_length=128)  # Qdrant point id, FK 아님
    chunk_index: int
    kind: str = Field(max_length=16)  # MARK_KINDS
    color: int | None = Field(default=None)  # 1~3, 앱 검증. bookmark 는 항상 None
    note: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class PassageHighlight(SQLModel, table=True):
    """ENT-HD-021 구절 형광펜 — 사용자가 고른 글자 범위와 메모 (API-HD-053).

    오프셋은 원문 뷰(API-HD-016) 청크 `display_text` 의 글자 위치이며 끝은 배타다. 한 구절은 같은 페이지 안의
    여러 단락에 걸칠 수 있어 unique 를 두지 않는다 — 한 단락에 여러 형광펜이 올 수 있다.
    """

    __tablename__ = "passage_highlights"
    __table_args__ = (Index("ix_passage_highlights_user_volume", "user_id", "volume"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    volume: str = Field(max_length=512)
    chunk_id: str = Field(max_length=128)  # 시작 단락의 Qdrant point id, FK 아님
    start_chunk_index: int
    start_offset: int
    end_chunk_index: int
    end_offset: int
    quote: str = Field(sa_column=Column(Text, nullable=False))  # 고른 글 그대로 — 목록 표시·재고정용
    color: int  # 1~3, 앱 검증
    note: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


# --- 함께 읽는 모임 (PLAN-HD-010, ENT-HD-013~017) ------------------------------------
# FK 에 ondelete 를 두지 않는다 — 삭제 순서는 GroupRepository 가 명시한다
# (share_reactions → group_shares → shared_jeongseongs → group_members → reading_groups).


class ReadingGroup(SQLModel, table=True):
    """ENT-HD-013 소그룹 모임. 모임당 유효 초대 코드 1개 — 재발급은 덮어쓰기라 이전 코드는 즉시 무효다."""

    __tablename__ = "reading_groups"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=20)  # 별칭. 교회명 필드·검색·공개 목록 없음
    kind: str = Field(default="small_group", max_length=16)  # GROUP_KINDS
    meeting_time: time | None = Field(default=None)  # 표시용
    invite_code: str = Field(max_length=16, unique=True, index=True)  # Crockford base32 XXXX-XXXX
    invite_expires_at: datetime  # aware UTC
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class GroupMember(SQLModel, table=True):
    """ENT-HD-014 모임원. 탈퇴·내보내기는 행 하드 삭제. 리더는 모임당 1명(부분 unique)."""

    __tablename__ = "group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_group_members_group_user"),
        UniqueConstraint("group_id", "display_name", name="uq_group_members_group_display_name"),
        Index(
            "uq_group_members_group_leader",
            "group_id",
            unique=True,
            postgresql_where=text("role = 'leader'"),
            sqlite_where=text("role = 'leader'"),
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    group_id: uuid.UUID = Field(foreign_key="reading_groups.id")  # 선두 unique 가 조회를 받는다
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    display_name: str = Field(max_length=12)  # 모임별 이름(앞뒤 공백 제거 후 저장)
    role: str = Field(default="member", max_length=16)  # GROUP_ROLES
    joined_at: datetime = Field(default_factory=utcnow)


class SharedJeongseong(SQLModel, table=True):
    """ENT-HD-015 함께 드리는 정성. group_id NULL = 공식 정성(모든 모임에 표시). 진행은 저장하지 않는다."""

    __tablename__ = "shared_jeongseongs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    group_id: uuid.UUID | None = Field(default=None, foreign_key="reading_groups.id", index=True)
    title: str = Field(max_length=40)
    started_on: date  # KST
    duration_days: int  # 1~100, 앱 검증
    source_note: str | None = Field(default=None, max_length=200)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class GroupShare(SQLModel, table=True):
    """ENT-HD-016 오늘의 한 줄. 1인 1일 1줄 — 다시 쓰면 덮어쓴다."""

    __tablename__ = "group_shares"
    __table_args__ = (
        UniqueConstraint("group_id", "member_id", "share_date", name="uq_group_shares_group_member_date"),
        Index("ix_group_shares_group_date", "group_id", "share_date"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    group_id: uuid.UUID = Field(foreign_key="reading_groups.id")
    member_id: uuid.UUID = Field(foreign_key="group_members.id", index=True)
    share_date: date  # KST
    body: str = Field(max_length=100)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class ShareReaction(SQLModel, table=True):
    """ENT-HD-017 "함께 머물렀어요" 1종. 종류 컬럼이 없고 (share, member) 가 PK 라 멱등이다."""

    __tablename__ = "share_reactions"

    share_id: uuid.UUID = Field(foreign_key="group_shares.id", primary_key=True)
    member_id: uuid.UUID = Field(foreign_key="group_members.id", primary_key=True, index=True)
    created_at: datetime = Field(default_factory=utcnow)


class TtsUsage(SQLModel, table=True):
    """ENT-HD-018 AI 낭독 새 합성 1건 (PLAN-HD-011). 월 글자 상한은 month 별 chars 합계, 사용자 한도는
    user_id 별 최근 24시간 chars 합계로 검사한다.

    합성 전에 글자 수를 먼저 적어 예약하고, 실패하면 Google 이 과금했을 수 있는 만큼으로 줄이거나 지운다.
    캐시 적중은 기록하지 않는다. user_id 는 한도 계산용이라 FK 를 두지 않는다(계정 삭제와 무관하게 비용 기록은 남는다).
    """

    __tablename__ = "hoondok_tts_usage"
    __table_args__ = (Index("ix_hoondok_tts_usage_user_created", "user_id", "created_at"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    month: str = Field(max_length=7, index=True)  # "YYYY-MM" (America/Los_Angeles — Google 청구 달)
    voice: str = Field(max_length=16)
    chars: int
    cache_key: str = Field(max_length=64)  # sha256 hex — 같은 파일을 다시 만든 경우를 추적한다
    user_id: uuid.UUID | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)


# --- 오늘의 책갈피 (PLAN-HD-012, ENT-HD-019·020) ------------------------------------


class WordCard(SQLModel, table=True):
    """ENT-HD-019 말씀 카드 풀. 본문은 원문 그대로이며 만든 뒤 바꾸지 않는다(admin 수정 불가).

    오늘 카드는 저장하지 않고 계산한다 — 그날 `pinned_on` 카드, 없으면 active 풀의 날짜 서수 회전
    (hoondok/cards_service.py `pick_today_card`).
    """

    __tablename__ = "word_cards"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    text: str = Field(sa_column=Column(Text, nullable=False))
    volume: str = Field(max_length=512, index=True)  # Qdrant payload 원문 그대로 — 권리 판정 키
    chunk_id: str = Field(max_length=128)  # Qdrant point id, FK 아님. 원문 역추적용이라 필수
    chunk_index: int
    work_title: str = Field(max_length=200)
    source_label: str = Field(max_length=300)  # 예: "천성경 제1편 하나님 p.42"
    topic: str | None = Field(default=None, max_length=200)
    status: str = Field(default="draft", max_length=16, sa_column_kwargs={"server_default": "draft"})  # CARD_STATUSES
    pinned_on: date | None = Field(default=None, unique=True)  # KST. 이 날 이 카드를 강제로 내보낸다
    created_at: datetime = Field(default_factory=utcnow)


class CardReceipt(SQLModel, table=True):
    """ENT-HD-020 나의 책갈피. 받은 날과 건넴 표시만 둔다 — 열람 수·받은 사람 정보는 저장하지 않는다."""

    __tablename__ = "card_receipts"
    __table_args__ = (UniqueConstraint("user_id", "card_id", name="uq_card_receipts_user_card"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    card_id: uuid.UUID = Field(foreign_key="word_cards.id", index=True)
    received_on: date  # KST. 서버가 today_kst() 로 정한다
    shared_at: datetime | None = Field(default=None)  # 처음 건넨 시각(UTC)
