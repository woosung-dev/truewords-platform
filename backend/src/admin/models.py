"""관리자 도메인 DB 모델: AdminUser, AdminAuditLog."""

import enum
import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel, Column
from sqlalchemy import JSON, Text


class AdminRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    VIEWER = "viewer"


class AdminUser(SQLModel, table=True):
    __tablename__ = "admin_users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    role: AdminRole = AdminRole.ADMIN
    is_active: bool = Field(default=True)
    organization_id: uuid.UUID | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AdminAuditLog(SQLModel, table=True):
    __tablename__ = "admin_audit_logs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    admin_user_id: uuid.UUID = Field(foreign_key="admin_users.id", index=True)
    action: str  # "chatbot_config.update" 등
    target_table: str
    target_id: uuid.UUID
    changes: dict = Field(default_factory=dict, sa_column=Column(JSON))
    ip_address: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
