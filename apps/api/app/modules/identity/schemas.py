"""훈독 identity Pydantic 스키마 — API-HD-002·003 (docs/specs/api/hoondok-api.md)."""

import re
import uuid

from pydantic import BaseModel, Field, field_validator

# email-validator 의존성 없이 형태만 검사한다(로컬@도메인.tld). 소문자 정규화는 repository 가 한다.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(value: str) -> str:
    value = value.strip()
    if not _EMAIL_RE.match(value):
        raise ValueError("이메일 형식이 올바르지 않습니다")
    return value


class SignupRequest(BaseModel):
    """약관 문구 확정 전(DEC-PWA-001)이라 consent_version 을 받지 않는다."""

    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=64)

    _email = field_validator("email")(_validate_email)


class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=1, max_length=128)

    _email = field_validator("email")(_validate_email)


class UserPublic(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str


class UserEnvelope(BaseModel):
    user: UserPublic
