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
        token = create_access_token(
            {"sub": str(user.id), "role": user.role, "email": user.email}
        )
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

    async def set_admin_active(
        self, user_id: uuid.UUID, is_active: bool, actor_id: uuid.UUID
    ) -> tuple[AdminUser, bool]:
        """관리자 계정 활성/비활성 전환. ``(계정, 실제로 변경됐는지)`` 를 반환한다.

        계정을 삭제하지 않고 로그인만 막는다. ``login`` 이 ``is_active`` 를 검사해
        비활성 계정은 403 을 받는다.

        주의: ``get_current_admin`` 은 JWT 만 디코드하고 DB 를 다시 보지 않으므로,
        이미 발급된 쿠키는 만료(``ADMIN_JWT_EXPIRE_MINUTES``)까지 살아 있다.
        즉시 차단이 필요하면 그 지점에 DB 재확인을 추가해야 한다.

        자기 계정 비활성화는 금지한다 — 관리 API 게이트를 통과하는 계정이 스스로를
        잠그면 UI 로 되돌릴 수 없고 DB 직접 수정이 필요해진다.
        """
        if not is_active and user_id == actor_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="본인 계정은 비활성화할 수 없습니다",
            )
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="계정을 찾을 수 없습니다",
            )
        # 멱등 — 중복 클릭이나 stale 화면에서 온 같은 값 요청이 감사 로그를 오염시키지 않도록.
        if user.is_active == is_active:
            return user, False
        await self.repo.set_user_active(user, is_active)
        await self.repo.commit()
        return user, True

    async def list_admins(
        self, limit: int = 100, offset: int = 0
    ) -> list[AdminUser]:
        """관리자 계정 목록 조회 (읽기 전용)."""
        return await self.repo.list_users(limit=limit, offset=offset)

    async def get_audit_logs(
        self, limit: int = 50, offset: int = 0
    ) -> list[AdminAuditLog]:
        """감사 로그 조회."""
        return await self.repo.get_audit_logs(limit=limit, offset=offset)

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
