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


class AuditLogResponse(BaseModel):
    id: uuid.UUID
    admin_user_id: uuid.UUID
    action: str
    target_table: str
    target_id: uuid.UUID
    changes: dict
    created_at: datetime
