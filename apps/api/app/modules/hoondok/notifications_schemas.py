"""훈독 알림 계약 — API-HD-019~022 (docs/specs/api/hoondok-api.md).

`read_time` 은 DB 에서 time 이지만 계약에서는 항상 "HH:MM" 문자열이다. 초·타임존을 노출하면
클라이언트마다 다르게 해석돼 발송 시각이 흔들린다(발송 기준은 KST 고정).
"""

import uuid
from datetime import datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

LockScreenLevel = Literal["neutral", "faith"]

# "HH:MM" 만 받는다 — "6:00"(한 자리), "06:00:00"(초 포함)은 422.
TIME_PATTERN = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"
DEFAULT_READ_TIME = "06:00"


def format_read_time(value: time) -> str:
    """time → "HH:MM". 초·마이크로초는 버린다."""
    return f"{value.hour:02d}:{value.minute:02d}"


def parse_read_time(value: str) -> time:
    """"HH:MM" → time. 스키마 pattern 을 통과한 값만 들어온다."""
    hour, minute = value.split(":")
    return time(int(hour), int(minute))


class PushConfigResponse(BaseModel):
    """API-HD-019 공개. VAPID 미설정이면 enabled=false·public_key=null — 비밀 키는 절대 내지 않는다."""

    enabled: bool
    public_key: str | None = None


class NotificationPreferenceInput(BaseModel):
    """API-HD-020 PUT — 부분 수정이 아니라 전체 교체다."""

    model_config = ConfigDict(extra="forbid")

    read_enabled: bool
    read_time: str = Field(default=DEFAULT_READ_TIME, pattern=TIME_PATTERN)
    lock_screen_level: LockScreenLevel = "neutral"


class NotificationPreferenceResponse(BaseModel):
    """API-HD-020. 설정 행이 없으면 기본값 + subscription_count=구독 수."""

    read_enabled: bool
    read_time: str
    lock_screen_level: LockScreenLevel
    subscription_count: int


class PushSubscriptionKeys(BaseModel):
    model_config = ConfigDict(extra="forbid")

    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushSubscriptionInput(BaseModel):
    """API-HD-021. 브라우저 PushSubscription.toJSON() 의 부분집합."""

    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1, max_length=2048)
    keys: PushSubscriptionKeys
    user_agent: str | None = Field(default=None, max_length=400)

    @field_validator("user_agent")
    @classmethod
    def truncate_user_agent(cls, value: str | None) -> str | None:
        """UA 는 식별이 아니라 장애 분류용이라 200자로 자른다(컬럼 길이)."""
        return value[:200] if value else value


class PushSubscriptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    endpoint: str
    created_at: datetime
