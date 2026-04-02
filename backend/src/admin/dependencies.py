"""관리자 DI 조립. Depends() 조립의 유일한 위치."""

import uuid

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.auth import decode_access_token
from src.admin.repository import AdminRepository
from src.admin.service import AdminService
from src.common.database import get_async_session

COOKIE_NAME = "admin_token"


async def get_admin_repository(
    session: AsyncSession = Depends(get_async_session),
) -> AdminRepository:
    return AdminRepository(session)


async def get_admin_service(
    repo: AdminRepository = Depends(get_admin_repository),
) -> AdminService:
    return AdminService(repo)


async def get_current_admin(request: Request) -> dict:
    """HttpOnly Cookie에서 JWT 토큰을 추출. 인증 실패 시 401."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="인증이 필요합니다",
        )
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다",
        )
    return {"user_id": uuid.UUID(payload["sub"]), "role": payload.get("role", "admin")}


async def verify_csrf(request: Request) -> None:
    """상태 변경 요청(POST/PUT/DELETE)에 대한 CSRF 방어.
    SameSite=Lax + 커스텀 헤더 검증."""
    if request.method in ("POST", "PUT", "DELETE"):
        if request.headers.get("X-Requested-With") != "XMLHttpRequest":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF 검증 실패",
            )
