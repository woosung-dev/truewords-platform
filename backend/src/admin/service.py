"""관리자 Service. 비즈니스 로직 담당, AsyncSession import 금지."""

import uuid

from fastapi import HTTPException, status

from src.admin.auth import create_access_token, hash_password, verify_password
from src.admin.models import AdminAuditLog, AdminRole, AdminUser
from src.admin.repository import AdminRepository
from src.admin.schemas import AdminLoginRequest, AdminLoginResponse, CreateAdminRequest


class AdminService:
    def __init__(self, repo: AdminRepository) -> None:
        self.repo = repo

    async def login(self, data: AdminLoginRequest) -> AdminLoginResponse:
        user = await self.repo.get_user_by_email(data.email)
        if not user or not verify_password(data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="이메일 또는 비밀번호가 올바르지 않습니다",
            )
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="비활성화된 계정입니다",
            )
        token = create_access_token({"sub": str(user.id), "role": user.role})
        return AdminLoginResponse(access_token=token)

    async def create_admin(self, data: CreateAdminRequest) -> AdminUser:
        existing = await self.repo.get_user_by_email(data.email)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="이미 등록된 이메일입니다",
            )
        user = AdminUser(
            email=data.email,
            hashed_password=hash_password(data.password),
            role=AdminRole(data.role),
        )
        saved = await self.repo.create_user(user)
        await self.repo.commit()
        return saved

    async def log_audit(
        self,
        admin_user_id: uuid.UUID,
        action: str,
        target_table: str,
        target_id: uuid.UUID,
        changes: dict,
        ip_address: str | None = None,
    ) -> None:
        log = AdminAuditLog(
            admin_user_id=admin_user_id,
            action=action,
            target_table=target_table,
            target_id=target_id,
            changes=changes,
            ip_address=ip_address,
        )
        await self.repo.create_audit_log(log)
        await self.repo.commit()
