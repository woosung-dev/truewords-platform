"""훈독 일반 사용자 DB 모델 — ENT-HD-001 users (docs/specs/domain/hoondok-entities.md)."""

import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    """naive UTC datetime (asyncpg 호환)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(SQLModel, table=True):
    """훈독 계정. admin_users 와 FK·컬럼을 공유하지 않는다."""

    __tablename__ = "users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    email: str = Field(unique=True, index=True, max_length=255)  # 소문자 정규화 후 저장
    password_hash: str = Field(max_length=255)
    display_name: str = Field(max_length=64)
    timezone: str = Field(default="Asia/Seoul", max_length=64)  # 예약 컬럼. 베타는 KST 고정(결정 9)
    consented_at: datetime | None = Field(default=None)  # 약관 문구 확정 전(DEC-PWA-001)에는 NULL
    consent_version: str | None = Field(default=None, max_length=32)
    created_at: datetime = Field(default_factory=_utcnow)
    deleted_at: datetime | None = Field(default=None)  # 소프트 삭제. 삭제 API 는 Phase 2 비범위
