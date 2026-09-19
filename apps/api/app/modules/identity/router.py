"""훈독 identity 라우터 — /hoondok/auth/* (공개 라우터 블록, admin 게이트 미적용)."""

from fastapi import APIRouter, Depends, Response, status

from app.core.config import settings
from app.modules.identity.dependencies import (
    cookie_opts,
    get_current_user,
    get_identity_service,
    get_user_data_purgers,
    verify_csrf,
)
from app.modules.identity.models import User
from app.modules.identity.schemas import LoginRequest, SignupRequest, UserEnvelope
from app.modules.identity.service import IdentityService, UserDataPurger

router = APIRouter(prefix="/hoondok/auth", tags=["hoondok"])


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(value=token, max_age=settings.hoondok_jwt_expire_minutes * 60, **cookie_opts())


@router.post(
    "/signup",
    response_model=UserEnvelope,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def signup(
    data: SignupRequest,
    response: Response,
    service: IdentityService = Depends(get_identity_service),
) -> UserEnvelope:
    """API-HD-002 가입 → 201 + hoondok_token 쿠키. 409 이메일 중복."""
    user = await service.signup(data)
    _set_cookie(response, service.issue_token(user))
    return UserEnvelope(user=service.to_public(user))


@router.post("/login", response_model=UserEnvelope, dependencies=[Depends(verify_csrf)])
async def login(
    data: LoginRequest,
    response: Response,
    service: IdentityService = Depends(get_identity_service),
) -> UserEnvelope:
    """API-HD-003 로그인 → 200 + 쿠키. 401 은 이메일 존재 여부를 구분하지 않는다."""
    user = await service.login(data)
    _set_cookie(response, service.issue_token(user))
    return UserEnvelope(user=service.to_public(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def logout(response: Response) -> None:
    """204 + 쿠키 만료. 만료·무효 토큰으로도 로그아웃할 수 있게 인증을 요구하지 않는다."""
    response.delete_cookie(**cookie_opts())


@router.get("/me", response_model=UserEnvelope)
async def me(user: User = Depends(get_current_user)) -> UserEnvelope:
    """API-HD-003 현재 사용자. 401 미인증 — web features/identity 게이트가 온보딩으로 보낸다."""
    return UserEnvelope(user=IdentityService.to_public(user))


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def delete_me(
    response: Response,
    user: User = Depends(get_current_user),
    service: IdentityService = Depends(get_identity_service),
    purgers: list[UserDataPurger] = Depends(get_user_data_purgers),
) -> None:
    """API-HD-011 내 데이터 삭제 → 204 + 쿠키 삭제. 훈독 기록 하드 삭제, 계정 소프트 삭제 + 이메일 익명화. 이후 me 는 401."""
    await service.delete_account(user, purgers)
    response.delete_cookie(**cookie_opts())
