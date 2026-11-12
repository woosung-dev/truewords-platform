"""훈독 identity Pydantic 스키마 — API-HD-002·003 (docs/specs/api/hoondok-api.md)."""

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# email-validator 의존성 없이 형태만 검사한다(로컬@도메인.tld). 소문자 정규화는 repository 가 한다.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(value: str) -> str:
    value = value.strip()
    if not _EMAIL_RE.match(value):
        raise ValueError("이메일 형식이 올바르지 않습니다")
    return value


class SignupRequest(BaseModel):
    """약관 문구 확정 전(DEC-PWA-001)이라 consent_version 을 받지 않는다.

    invite_code 는 제한 베타 게이트(Phase 3 F) 용 선택 필드 — HOONDOK_INVITE_CODE 미설정이면 무시된다.
    """

    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=64)
    invite_code: str | None = Field(default=None, max_length=64)

    _email = field_validator("email")(_validate_email)


class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=1, max_length=128)

    _email = field_validator("email")(_validate_email)


class LoginMethod(BaseModel):
    """계정에 연결된 로그인 수단. 비밀번호는 provider="password"·identity_id=None 이다."""

    provider: str
    identity_id: uuid.UUID | None = None
    email: str | None = None
    linked_at: datetime | None = None


class UserPublic(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    login_methods: list[LoginMethod] = Field(default_factory=list)


class UserEnvelope(BaseModel):
    user: UserPublic


class OAuthStartRequest(BaseModel):
    """return_to 는 서버가 검증한다(통과 못 하면 "/"). invite_code 가 틀려도 막지 않는다(재로그인일 수 있다)."""

    intent: Literal["login", "link"]
    return_to: str | None = Field(default=None, max_length=2048)  # 서버 검증은 512 초과를 "/" 로 본다
    invite_code: str | None = Field(default=None, max_length=64)
    # intent=link 이고 계정에 비밀번호가 있을 때만 쓴다(재확인). 소셜 전용 계정은 보내지 않는다.
    password: str | None = Field(default=None, max_length=128)


class OAuthStartResponse(BaseModel):
    authorization_url: str
