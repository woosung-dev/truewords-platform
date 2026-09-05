"""관리자 DI 조립. Depends() 조립의 유일한 위치."""

import uuid

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.analytics_repository import AnalyticsRepository
from app.modules.admin.analytics_service import AnalyticsService
from app.modules.admin.auth import decode_access_token
from app.modules.admin.repository import AdminRepository
from app.modules.admin.service import AdminService
from app.core.common.database import get_async_session
from app.core.config import settings

COOKIE_NAME = "admin_token"


async def get_admin_repository(
    session: AsyncSession = Depends(get_async_session),
) -> AdminRepository:
    return AdminRepository(session)


async def get_admin_service(
    repo: AdminRepository = Depends(get_admin_repository),
) -> AdminService:
    return AdminService(repo)


async def get_analytics_repository(
    session: AsyncSession = Depends(get_async_session),
) -> AnalyticsRepository:
    return AnalyticsRepository(session)


async def get_analytics_service(
    repo: AnalyticsRepository = Depends(get_analytics_repository),
) -> AnalyticsService:
    return AnalyticsService(repo)


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
    return {
        "user_id": uuid.UUID(payload["sub"]),
        "role": payload.get("role", "admin"),
        "email": payload.get("email"),  # 구 토큰엔 없음 → None (재로그인 유도)
    }


# ponytail: 레드팀 시연 한시 게이트 — 시연 종료 후 AdminRole 기반 권한으로 교체/삭제.
# 계정은 env DEMO_ADMIN_EMAIL (settings.demo_admin_email). 코드에 개인 이메일을 두지 않는다.
def demo_admin_email() -> str:
    """게이트 이메일을 소문자·공백 정규화해 돌려준다. 미설정이면 빈 문자열."""
    return settings.demo_admin_email.strip().lower()


async def require_admin_gate(
    current_admin: dict = Depends(get_current_admin),
) -> dict:
    """시연 기간: 게이트 계정만 admin API 허용. 그 외/구 토큰(email 無)/게이트 미설정은 403."""
    gate = demo_admin_email()
    # 빈 게이트와 빈 이메일이 "일치" 로 새지 않도록 미설정을 먼저 거른다.
    if not gate or (current_admin.get("email") or "").lower() != gate:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 없습니다",
        )
    return current_admin


async def verify_csrf(request: Request) -> None:
    """상태 변경 요청(POST/PUT/PATCH/DELETE)에 대한 CSRF 방어.
    SameSite=Lax + 커스텀 헤더 검증.

    audit 2차 C-2 (2026-05-15): PATCH 누락 보강. data_router 의
    /display-name PATCH 등 신규 도메인 변경 메서드가 통과하던 결함 fix.
    """
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if request.headers.get("X-Requested-With") != "XMLHttpRequest":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF 검증 실패",
            )
