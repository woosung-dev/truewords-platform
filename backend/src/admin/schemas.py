"""관리자 Pydantic 스키마."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class AdminLoginRequest(BaseModel):
    email: str
    password: str


class AdminLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AdminMeResponse(BaseModel):
    user_id: uuid.UUID
    role: str
    email: str | None = None


class AdminUserResponse(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    is_active: bool
    created_at: datetime


class CreateAdminRequest(BaseModel):
    email: str
    password: str
    role: str = "admin"


class UpdateAdminStatusRequest(BaseModel):
    """관리자 계정 활성/비활성 전환. 계정을 삭제하지 않고 로그인만 차단한다."""
    is_active: bool


class AuditLogResponse(BaseModel):
    id: uuid.UUID
    admin_user_id: uuid.UUID
    action: str
    target_table: str
    target_id: uuid.UUID
    changes: dict
    created_at: datetime


class MessageResponse(BaseModel):
    """단순 메시지 응답 (로그인/로그아웃 등)."""
    message: str


class SettingsConfigResponse(BaseModel):
    """관리자 UI 가 표시할 시스템 설정. Qdrant URL 은 host 만 노출 (api-key 등 민감 정보 제외)."""
    gemini_tier: str
    environment: str
    collection_name: str
    qdrant_host: str
