"""훈독 일반 사용자 DB 모델 — ENT-HD-001 users (docs/specs/domain/hoondok-entities.md)."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.core.common.clock import utcnow


class User(SQLModel, table=True):
    """훈독 계정. admin_users 와 FK·컬럼을 공유하지 않는다."""

    __tablename__ = "users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    email: str = Field(unique=True, index=True, max_length=255)  # 소문자 정규화 후 저장
    password_hash: str | None = Field(default=None, max_length=255)  # 소셜 로그인 전용 계정은 NULL
    display_name: str = Field(max_length=64)
    timezone: str = Field(default="Asia/Seoul", max_length=64)  # 예약 컬럼. 베타는 KST 고정(결정 9)
    consented_at: datetime | None = Field(default=None)  # 약관 문구 확정 전(DEC-PWA-001)에는 NULL
    consent_version: str | None = Field(default=None, max_length=32)
    created_at: datetime = Field(default_factory=utcnow)
    deleted_at: datetime | None = Field(default=None)  # 소프트 삭제. 삭제 API 는 Phase 2 비범위
    email_verified_at: datetime | None = Field(default=None)  # 권위 있는 제공자가 이메일을 확인한 시각
    email_verified_by: str | None = Field(default=None, max_length=255)  # 확인한 제공자 issuer
    # 로그인 수단이 바뀔 때(연결·해제) 올린다. 세션 토큰의 sv 와 다르면 미인증 — 옛 세션을 끊는다.
    # server_default 가 있어 이 컬럼을 모르는 직전 이미지가 INSERT 해도 0 으로 들어간다.
    session_version: int = Field(default=0, sa_column_kwargs={"server_default": "0"})


class UserIdentity(SQLModel, table=True):
    """로그인 수단(제공자 계정). 계정 키는 (issuer, subject_scope, subject)이며 이메일은 키가 아니다."""

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("issuer", "subject_scope", "subject", name="uq_user_identities_subject"),
        UniqueConstraint("user_id", "issuer", "subject_scope", name="uq_user_identities_user_issuer"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", ondelete="CASCADE", nullable=False)
    provider: str = Field(max_length=32)  # ENUM 이 아니라 varchar + 앱 검증
    issuer: str = Field(max_length=255)
    subject_scope: str = Field(default="", max_length=255, sa_column_kwargs={"server_default": ""})  # sub 가 앱 단위인 제공자만 채운다
    subject: str = Field(max_length=255)
    client_id: str = Field(max_length=255)
    email: str | None = Field(default=None, max_length=255)  # 소문자 정규화 힌트
    email_verified: bool | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)
    last_login_at: datetime | None = Field(default=None)
