"""관리자 API 라우터."""

import uuid

from fastapi import APIRouter, Depends, Request, Response

from app.modules.admin.dependencies import (
    COOKIE_NAME,
    get_admin_service,
    get_current_admin,
    require_admin_gate,
    verify_csrf,
)
from app.modules.admin.schemas import (
    AdminLoginRequest,
    AdminMeResponse,
    AdminUserResponse,
    AuditLogResponse,
    CreateAdminRequest,
    MessageResponse,
    SettingsConfigResponse,
    UpdateAdminStatusRequest,
)
from app.modules.admin.service import AdminService
from app.core.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])

# Cookie 공통 설정
_COOKIE_OPTS = {
    "key": COOKIE_NAME,
    "httponly": True,
    "secure": settings.cookie_secure,
    "samesite": "none" if settings.cookie_secure else "lax",
    "path": "/",
    "max_age": settings.admin_jwt_expire_minutes * 60,
}


@router.post("/auth/login", response_model=MessageResponse)
async def login(
    data: AdminLoginRequest,
    response: Response,
    service: AdminService = Depends(get_admin_service),
) -> MessageResponse:
    """로그인 → HttpOnly Cookie로 JWT 발급."""
    login_result = await service.login(data)
    response.set_cookie(value=login_result.access_token, **_COOKIE_OPTS)
    return MessageResponse(message="로그인 성공")


@router.post("/auth/logout", response_model=MessageResponse)
async def logout(
    response: Response,
    current_admin: dict = Depends(get_current_admin),
) -> MessageResponse:
    """로그아웃 → Cookie 삭제."""
    response.delete_cookie(
        key=COOKIE_NAME,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="none" if settings.cookie_secure else "lax",
        path="/",
    )
    return MessageResponse(message="로그아웃 완료")


@router.get("/auth/me", response_model=AdminMeResponse)
async def get_me(
    current_admin: dict = Depends(get_current_admin),
) -> AdminMeResponse:
    """현재 인증된 관리자 정보 반환 (세션 유효성 확인)."""
    return AdminMeResponse(
        user_id=current_admin["user_id"],
        role=current_admin["role"],
        email=current_admin.get("email"),
    )


@router.post(
    "/users",
    response_model=AdminUserResponse,
    status_code=201,
    dependencies=[Depends(verify_csrf), Depends(require_admin_gate)],
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


@router.get(
    "/users",
    response_model=list[AdminUserResponse],
    dependencies=[Depends(require_admin_gate)],
)
async def list_admin_users(
    service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[AdminUserResponse]:
    """관리자 계정 목록 조회 (읽기 전용)."""
    users = await service.list_admins()
    return [
        AdminUserResponse(
            id=user.id,
            email=user.email,
            role=user.role,
            is_active=user.is_active,
            created_at=user.created_at,
        )
        for user in users
    ]


@router.patch(
    "/users/{user_id}/status",
    response_model=AdminUserResponse,
    dependencies=[Depends(verify_csrf), Depends(require_admin_gate)],
)
async def update_admin_user_status(
    user_id: uuid.UUID,
    data: UpdateAdminStatusRequest,
    request: Request,
    service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> AdminUserResponse:
    """관리자 계정 활성/비활성 전환.

    계정을 삭제하지 않고 로그인만 막는다(되돌릴 수 있음). 체험단 등 한시 계정의
    접근을 종료할 때 사용한다.
    """
    user, changed = await service.set_admin_active(
        user_id=user_id,
        is_active=data.is_active,
        actor_id=current_admin["user_id"],
    )
    # 실제 변경이 있었을 때만 감사 로그 — 멱등 재요청이 이력을 오염시키지 않도록.
    if changed:
        await service.log_audit(
            admin_user_id=current_admin["user_id"],
            action="admin_user.activate" if data.is_active else "admin_user.deactivate",
            target_table="admin_users",
            target_id=user.id,
            changes={"email": user.email, "is_active": data.is_active},
            ip_address=request.client.host if request.client else None,
        )
    return AdminUserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.get(
    "/audit-logs",
    response_model=list[AuditLogResponse],
    dependencies=[Depends(require_admin_gate)],
)
async def get_audit_logs(
    limit: int = 50,
    offset: int = 0,
    service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[AuditLogResponse]:
    logs = await service.get_audit_logs(limit=limit, offset=offset)
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


@router.get(
    "/settings/config",
    response_model=SettingsConfigResponse,
    dependencies=[Depends(require_admin_gate)],
)
async def get_settings_config(
    current_admin: dict = Depends(get_current_admin),
) -> SettingsConfigResponse:
    """프론트엔드에 필요한 시스템 설정 조회.

    Admin UI 의 데이터 소스 페이지가 적재 대상 컬렉션을 표시할 때 사용한다
    (사용자가 "어떤 컬렉션에 들어가는지" 인지 — 운영 사고 방지).

    Qdrant URL 은 host 만 노출 (api-key 등 민감정보 제외).
    """
    qdrant_host = settings.qdrant_url.replace("https://", "").replace("http://", "").split("/")[0]
    return SettingsConfigResponse(
        gemini_tier=settings.gemini_tier,
        environment=settings.environment,
        collection_name=settings.collection_name,
        qdrant_host=qdrant_host,
    )
