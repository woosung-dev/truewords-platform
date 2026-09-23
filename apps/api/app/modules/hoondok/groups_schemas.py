"""훈독 함께 읽는 모임 스키마 — API-HD-030~043 (PLAN-HD-010, docs/specs/api/hoondok-api.md).

개인정보 경계(계획 §5): 모임원 응답에는 미완료자 목록·수·상태와 전체 인원(member_count)을 넣지 않는다.
예외는 리더 식구 목록(API-HD-038)과 admin 목록(API-HD-043) 뿐이다. user_id 는 어떤 응답에도 없다.
"""

import re
import uuid
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field, field_validator

GroupKind = Literal["small_group"]
GroupRole = Literal["leader", "member"]
JeongseongState = Literal["upcoming", "active"]

_SPACES = re.compile(r"[ \t 　]+")


def _strip(value: object) -> object:
    """앞뒤 공백 제거 — 이후 min_length=1 이 적용돼 공백만 있는 값은 422."""
    return value.strip() if isinstance(value, str) else value


def normalize_share_body(value: object) -> object:
    """한 줄 본문 정리: 줄마다 앞뒤 공백 제거 · 연속 공백 1칸 · 빈 줄 제거 · CRLF → LF."""
    if not isinstance(value, str):
        return value
    lines = (_SPACES.sub(" ", line).strip() for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n"))
    return "\n".join(line for line in lines if line)


# --- 요청 --------------------------------------------------------------------


class GroupJeongseongInput(BaseModel):
    """API-HD-031 선택 항목 · API-HD-039 본문. started_on 범위(오늘±30)는 service 가 422 로 검사한다."""

    title: str = Field(min_length=1, max_length=24)
    duration_days: int = Field(ge=1, le=100)
    started_on: date

    _title = field_validator("title", mode="before")(_strip)


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    display_name: str = Field(min_length=1, max_length=12)
    meeting_time: time | None = None
    jeongseong: GroupJeongseongInput | None = None

    _name = field_validator("name", "display_name", mode="before")(_strip)


class GroupRename(BaseModel):
    name: str = Field(min_length=1, max_length=20)

    _name = field_validator("name", mode="before")(_strip)


class DisplayNameInput(BaseModel):
    """API-HD-036 참여 · API-HD-037 이름 변경. 앞뒤 공백만 다른 이름은 같은 이름이다."""

    display_name: str = Field(min_length=1, max_length=12)

    _display_name = field_validator("display_name", mode="before")(_strip)


class ShareInput(BaseModel):
    body: str = Field(min_length=1, max_length=100)

    _body = field_validator("body", mode="before")(normalize_share_body)


class OfficialJeongseongInput(BaseModel):
    """API-HD-042 공식 정성 등록·수정(전체 교체)."""

    title: str = Field(min_length=1, max_length=40)
    started_on: date
    duration_days: int = Field(ge=1, le=100)
    source_note: str | None = Field(default=None, max_length=200)

    _title = field_validator("title", mode="before")(_strip)


# --- 응답 --------------------------------------------------------------------


class GroupJeongseongOut(BaseModel):
    """진행은 저장하지 않는다. day_index = (오늘 - started_on) + 1, 시작 전이면 null(state=upcoming)."""

    id: uuid.UUID
    title: str
    started_on: date
    duration_days: int
    day_index: int | None
    state: JeongseongState
    is_official: bool
    # 공식 정성의 출처(관리자 입력, 예: "협회 공지"). 모임 정성·출처 미입력은 null
    source_note: str | None


class MyGroupItem(BaseModel):
    """API-HD-030. today_read_count 는 오늘 완료자 수(전체 인원이 아니다)."""

    id: uuid.UUID
    name: str
    kind: GroupKind
    role: GroupRole
    my_display_name: str
    today_read_count: int
    readers_preview: list[str]  # 완료자 이름 첫 글자, 최대 3
    jeongseongs: list[GroupJeongseongOut]


class TodayReadingSummary(BaseModel):
    """오늘 공식 편성 요약. 원문 링크는 web 이 id·chunk_id 로 만든다."""

    id: uuid.UUID
    reading_date: date
    title: str
    speaker: str
    work_title: str
    chunk_id: str | None
    estimated_minutes: int


class GroupReader(BaseModel):
    """오늘 훈독을 마친 모임원 — 완료자만 존재한다."""

    display_name: str
    read_at_kst: datetime
    is_me: bool
    is_leader: bool


class GroupShareOut(BaseModel):
    """reaction_count 는 내 한 줄에만 값, 남의 한 줄은 null. 반응한 사람 목록은 주지 않는다."""

    id: uuid.UUID
    display_name: str
    body: str
    created_at_kst: datetime
    is_mine: bool
    has_my_reaction: bool
    reaction_count: int | None


class GroupMe(BaseModel):
    member_id: uuid.UUID
    display_name: str
    role: GroupRole
    has_read_today: bool
    has_shared_today: bool


class GroupDetail(BaseModel):
    """API-HD-032 · 031 응답. 전체 인원 없음. invite_code 는 리더에게만 값이 있다."""

    id: uuid.UUID
    name: str
    kind: GroupKind
    leader_display_name: str
    meeting_time: time | None
    date: date
    today_reading: TodayReadingSummary | None
    jeongseongs: list[GroupJeongseongOut]
    readers: list[GroupReader]
    shares: list[GroupShareOut]
    me: GroupMe
    invite_code: str | None = None
    invite_expires_at: datetime | None = None


class InviteOut(BaseModel):
    invite_code: str
    invite_expires_at: datetime


class InvitePreview(BaseModel):
    """API-HD-035. 전체 인원 없음. 이미 모임원이면 is_member=true + group_id."""

    name: str
    kind: GroupKind
    leader_display_name: str
    jeongseongs: list[GroupJeongseongOut]
    is_member: bool
    group_id: uuid.UUID | None = None


class JoinResult(BaseModel):
    group_id: uuid.UUID


class MemberItem(BaseModel):
    """API-HD-038 — 읽음 상태 필드는 두지 않는다."""

    id: uuid.UUID
    display_name: str
    role: GroupRole
    joined_at: datetime


class MemberList(BaseModel):
    member_count: int
    items: list[MemberItem]


class ReactionState(BaseModel):
    has_reacted: bool


class OfficialJeongseongOut(BaseModel):
    id: uuid.UUID
    title: str
    started_on: date
    duration_days: int
    source_note: str | None
    created_at: datetime
    updated_at: datetime


class AdminGroupItem(BaseModel):
    """API-HD-043 — 모임원 이름·한 줄 본문은 내지 않는다."""

    id: uuid.UUID
    name: str
    member_count: int
    created_at: datetime
