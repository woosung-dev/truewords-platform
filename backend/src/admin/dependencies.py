"""관리자 DI 조립. Depends() 조립의 유일한 위치."""

import uuid

from fastapi import Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.auth import decode_access_token
from src.admin.repository import AdminRepository
from src.admin.service import AdminService
from src.common.database import get_async_session


async def get_admin_repository(
    session: AsyncSession = Depends(get_async_session),
) -> AdminRepository:
    return AdminRepository(session)


async def get_admin_service(
    repo: AdminRepository = Depends(get_admin_repository),
) -> AdminService:
    return AdminService(repo)


async def get_current_admin(
    authorization: str = Header(...),
) -> dict:
    """JWT 토큰에서 관리자 정보를 추출. 인증 실패 시 401."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer 토큰이 필요합니다",
        )
    token = authorization.removeprefix("Bearer ")
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다",
        )
    return {"user_id": uuid.UUID(payload["sub"]), "role": payload.get("role", "admin")}
