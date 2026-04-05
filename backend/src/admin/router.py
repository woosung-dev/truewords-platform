"""관리자 API 라우터."""

from fastapi import APIRouter, Depends, Response

from src.admin.dependencies import (
    COOKIE_NAME,
    get_admin_service,
    get_current_admin,
    verify_csrf,
)
from src.admin.schemas import (
    AdminLoginRequest,
    AdminMeResponse,
    AdminUserResponse,
    AuditLogResponse,
    CreateAdminRequest,
)
from src.admin.service import AdminService
from src.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])

# Cookie 공통 설정
_COOKIE_OPTS = {
    "key": COOKIE_NAME,
    "httponly": True,
    "secure": settings.cookie_secure,
    "samesite": "none",
    "path": "/",
    "max_age": settings.admin_jwt_expire_minutes * 60,
}


@router.post("/auth/login")
async def login(
    data: AdminLoginRequest,
    response: Response,
    service: AdminService = Depends(get_admin_service),
) -> dict:
    """로그인 → HttpOnly Cookie로 JWT 발급."""
    login_result = await service.login(data)
    response.set_cookie(value=login_result.access_token, **_COOKIE_OPTS)
    return {"message": "로그인 성공"}


@router.post("/auth/logout")
async def logout(
    response: Response,
    current_admin: dict = Depends(get_current_admin),
) -> dict:
    """로그아웃 → Cookie 삭제."""
    response.delete_cookie(
        key=COOKIE_NAME,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="none",
        path="/",
    )
    return {"message": "로그아웃 완료"}


@router.get("/auth/me", response_model=AdminMeResponse)
async def get_me(
    current_admin: dict = Depends(get_current_admin),
) -> AdminMeResponse:
    """현재 인증된 관리자 정보 반환 (세션 유효성 확인)."""
    return AdminMeResponse(
        user_id=current_admin["user_id"],
        role=current_admin["role"],
    )


@router.post(
    "/users",
    response_model=AdminUserResponse,
    status_code=201,
    dependencies=[Depends(verify_csrf)],
)
async def create_admin_user(
    data: CreateAdminRequest,
    service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> AdminUserResponse:
    user = await service.create_admin(data)
    return AdminUserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.get("/audit-logs", response_model=list[AuditLogResponse])
async def get_audit_logs(
    limit: int = 50,
    offset: int = 0,
    service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[AuditLogResponse]:
    logs = await service.repo.get_audit_logs(limit=limit, offset=offset)
    return [
        AuditLogResponse(
            id=log.id,
            admin_user_id=log.admin_user_id,
            action=log.action,
            target_table=log.target_table,
            target_id=log.target_id,
            changes=log.changes,
            created_at=log.created_at,
        )
        for log in logs
    ]
