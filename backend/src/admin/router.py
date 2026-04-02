"""관리자 API 라우터."""

from fastapi import APIRouter, Depends, Request

from src.admin.dependencies import get_admin_service, get_current_admin
from src.admin.schemas import (
    AdminLoginRequest,
    AdminLoginResponse,
    AdminUserResponse,
    AuditLogResponse,
    CreateAdminRequest,
)
from src.admin.service import AdminService

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/auth/login", response_model=AdminLoginResponse)
async def login(
    data: AdminLoginRequest,
    service: AdminService = Depends(get_admin_service),
) -> AdminLoginResponse:
    return await service.login(data)


@router.post(
    "/users",
    response_model=AdminUserResponse,
    status_code=201,
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
