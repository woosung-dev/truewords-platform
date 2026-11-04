"""훈독 알림 계약 — API-HD-019~022 (docs/specs/api/hoondok-api.md).

`read_time` 은 DB 에서 time 이지만 계약에서는 항상 "HH:MM" 문자열이다. 초·타임존을 노출하면
클라이언트마다 다르게 해석돼 발송 시각이 흔들린다(발송 기준은 KST 고정).
"""

import uuid
from urllib.parse import urlsplit

from datetime import datetime, time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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

    @model_validator(mode="before")
    @classmethod
    def _drop_removed_fields(cls, data: Any) -> Any:
        """2026-09-28 에 없앤 잠금 화면 문구 필드. 이전 화면이 아직 보내도 422 가 되지 않게 버린다."""
        if isinstance(data, dict) and "lock_screen_level" in data:
            data = {k: v for k, v in data.items() if k != "lock_screen_level"}
        return data


class NotificationPreferenceResponse(BaseModel):
    """API-HD-020. 설정 행이 없으면 기본값 + subscription_count=구독 수."""

    read_enabled: bool
    read_time: str
    subscription_count: int


# 브라우저 푸시 서비스 호스트(정확히 같거나 그 하위 도메인). Chrome·Android·삼성 인터넷·Opera = FCM, Firefox = Mozilla,
# Safari·iOS = Apple, Edge = WNS. [확인 필요] 이 밖의 브라우저가 구독을 못 한다는 신고가 오면 그 호스트를 더한다.
PUSH_SERVICE_HOSTS = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
)


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

    @field_validator("endpoint")
    @classmethod
    def endpoint_must_be_push_service(cls, value: str) -> str:
        """발송기가 VM 안에서 이 URL 로 POST 한다 — 브라우저 푸시 서비스 호스트(https)만 받는다.

        호스트 문자열만 보는 차단 목록은 Compose 서비스 이름(`backend`)·사설 IP 로 풀리는 DNS·정수 IP·리다이렉트로
        우회돼 blind SSRF 가 된다(보안 점검 push-endpoint-ssrf-dns-redirect). 그래서 허용 목록으로 묶는다.
        """
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not host or parsed.port not in (None, 443):
            raise ValueError("endpoint 는 https URL 이어야 합니다")
        if not any(host == suffix or host.endswith("." + suffix) for suffix in PUSH_SERVICE_HOSTS):
            raise ValueError("endpoint 는 브라우저 푸시 서비스 주소여야 합니다")
        return value

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
