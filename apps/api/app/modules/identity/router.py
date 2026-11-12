"""훈독 identity 라우터 — /hoondok/auth/* (공개 라우터 블록, admin 게이트 미적용)."""

import hmac
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.modules.identity import oauth_flow
from app.modules.identity.dependencies import (
    cookie_opts,
    get_current_user,
    get_identity_service,
    get_login_providers,
    get_oauth_service,
    get_optional_user,
    get_user_data_purgers,
    verify_csrf,
)
from app.modules.identity.exceptions import IdentityError, InviteRequiredError
from app.modules.identity.models import User
from app.modules.identity.oauth_service import OAuthService
from app.modules.identity.oidc import LoginProvider
from app.modules.identity.schemas import (
    LoginRequest,
    OAuthStartRequest,
    OAuthStartResponse,
    SignupRequest,
    UserEnvelope,
)
from app.modules.identity.service import IdentityService, UserDataPurger, check_invite_code
from app.modules.safety.exceptions import RateLimitExceededError
from app.modules.safety.middleware import check_login_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hoondok/auth", tags=["hoondok"])


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(value=token, max_age=settings.hoondok_jwt_expire_minutes * 60, **cookie_opts())


@router.post(
    "/signup",
    # 계약 호환: 기존 201·UserEnvelope 선언은 유지하고(응답 제거는 하위 호환 깨짐) 410 만 더한다. 실제로는 항상 410 이다.
    response_model=UserEnvelope,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_410_GONE: {"description": "PASSWORD_SIGNUP_CLOSED — 이메일·비밀번호 가입 종료"}},
    deprecated=True,
)
async def signup(data: SignupRequest) -> UserEnvelope:
    """이메일·비밀번호 가입은 닫혔다 → 항상 410 PASSWORD_SIGNUP_CLOSED. 새 계정은 구글 로그인으로 만든다."""
    raise IdentityError(
        status.HTTP_410_GONE, "PASSWORD_SIGNUP_CLOSED", "이메일 가입은 더 이상 열려 있지 않아요. Google로 시작해 주세요"
    )


@router.post(
    "/login",
    response_model=UserEnvelope,
    dependencies=[Depends(verify_csrf), Depends(check_login_rate_limit)],
    deprecated=True,
)
async def login(
    data: LoginRequest,
    response: Response,
    service: IdentityService = Depends(get_identity_service),
) -> UserEnvelope:
    """API-HD-003 로그인 → 200 + 쿠키(기존 이메일 계정의 구글 연결용 임시 경로). 401 은 이메일 존재 여부·비밀번호 없는 계정을 구분하지 않는다."""
    user = await service.login(data)
    _set_cookie(response, service.issue_token(user))
    return UserEnvelope(user=await service.public_user(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def logout(response: Response) -> None:
    """204 + 쿠키 만료. 만료·무효 토큰으로도 로그아웃할 수 있게 인증을 요구하지 않는다."""
    response.delete_cookie(**cookie_opts())


@router.get("/me", response_model=UserEnvelope)
async def me(
    user: User = Depends(get_current_user),
    service: IdentityService = Depends(get_identity_service),
) -> UserEnvelope:
    """API-HD-003 현재 사용자 + 로그인 수단. 401 미인증 — web features/identity 게이트가 온보딩으로 보낸다."""
    return UserEnvelope(user=await service.public_user(user))


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def delete_me(
    response: Response,
    user: User = Depends(get_current_user),
    service: IdentityService = Depends(get_identity_service),
    purgers: list[UserDataPurger] = Depends(get_user_data_purgers),
) -> None:
    """API-HD-011 내 데이터 삭제 → 204 + 쿠키 삭제. 훈독 기록·로그인 수단 하드 삭제, 계정 소프트 삭제 + 이메일 익명화. 이후 me 는 401."""
    await service.delete_account(user, purgers)
    response.delete_cookie(**cookie_opts())


@router.delete(
    "/identities/{identity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
async def delete_identity(
    identity_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: IdentityService = Depends(get_identity_service),
) -> None:
    """로그인 수단 해제 → 204. 404 IDENTITY_NOT_FOUND(남의 것 포함) · 409 LAST_LOGIN_METHOD."""
    await service.remove_identity(user, identity_id)


def _unavailable() -> IdentityError:
    return IdentityError(status.HTTP_404_NOT_FOUND, "OAUTH_PROVIDER_UNAVAILABLE", "지금은 이 방법으로 로그인할 수 없어요")


@router.post(
    "/oauth/{provider}/start",
    response_model=OAuthStartResponse,
    dependencies=[Depends(verify_csrf), Depends(check_login_rate_limit)],
)
async def oauth_start(
    provider: str,
    data: OAuthStartRequest,
    response: Response,
    user: User | None = Depends(get_optional_user),
    providers: dict[str, LoginProvider] = Depends(get_login_providers),
) -> OAuthStartResponse:
    """제공자 로그인 시작 → 200 {authorization_url} + 흐름 쿠키(hoondok_oauth, 10분).

    404 OAUTH_PROVIDER_UNAVAILABLE · 401(intent=link 인데 세션 없음). invite_code 가 틀려도 막지 않는다 —
    초대 게이트는 새 계정을 만드는 콜백에서만 확인한다(재로그인 사용자일 수 있다).
    """
    login_provider = providers.get(provider)
    if login_provider is None:
        raise _unavailable()
    if data.intent == "link" and user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다")
    try:
        await check_invite_code(data.invite_code)
        invite_ok = True
    except InviteRequiredError:
        invite_ok = False
    flow = oauth_flow.OAuthFlow(
        state=oauth_flow.new_token(),
        nonce=oauth_flow.new_token(),
        code_verifier=oauth_flow.new_token(),
        provider=provider,
        intent=data.intent,
        return_to=oauth_flow.safe_return_to(data.return_to),
        link_user_id=user.id if (data.intent == "link" and user is not None) else None,
        invite_ok=invite_ok,
    )
    url = login_provider.authorization_url(
        redirect_uri=oauth_flow.redirect_uri(provider),
        state=flow.state,
        nonce=flow.nonce,
        code_challenge=oauth_flow.pkce_challenge(flow.code_verifier),
    )
    response.set_cookie(
        value=oauth_flow.encode_flow(flow), max_age=oauth_flow.FLOW_TTL_SECONDS, **oauth_flow.flow_cookie_opts()
    )
    response.headers["Cache-Control"] = "no-store"
    return OAuthStartResponse(authorization_url=url)


def _redirect(*, status_: str | None = None, error: str | None = None, return_to: str | None = None) -> RedirectResponse:
    """콜백은 항상 302 — 성공·실패 모두 흐름 쿠키를 지우고 캐시·Referer 로 코드가 새지 않게 한다."""
    response = RedirectResponse(
        oauth_flow.result_url(status=status_, error=error, return_to=return_to), status_code=status.HTTP_302_FOUND
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    opts = oauth_flow.flow_cookie_opts()
    response.delete_cookie(**opts)
    return response


@router.get("/oauth/{provider}/callback", status_code=status.HTTP_302_FOUND, response_class=RedirectResponse)
async def oauth_callback(
    provider: str,
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    current_user: User | None = Depends(get_optional_user),
    providers: dict[str, LoginProvider] = Depends(get_login_providers),
    oauth: OAuthService = Depends(get_oauth_service),
) -> RedirectResponse:
    """제공자가 돌려보내는 곳. 항상 302 `{WEB}/onboarding/done?status=…|error=…` — 응답 본문·JSON 오류를 내지 않는다."""
    try:
        await check_login_rate_limit(request)
    except RateLimitExceededError:
        return _redirect(error="failed")
    flow = oauth_flow.decode_flow(request.cookies.get(oauth_flow.FLOW_COOKIE_NAME))
    login_provider = providers.get(provider)
    if (
        flow is None
        or login_provider is None
        or flow.provider != provider
        or not state
        or not hmac.compare_digest(state.encode("utf-8"), flow.state.encode("utf-8"))
    ):
        return _redirect(error="failed")  # 토큰 엔드포인트는 호출하지 않는다
    if error:
        return _redirect(error="cancelled")
    if not code:
        return _redirect(error="failed")
    try:
        external = await login_provider.complete(
            code=code,
            redirect_uri=oauth_flow.redirect_uri(provider),
            code_verifier=flow.code_verifier,
            nonce=flow.nonce,
        )
        outcome = await oauth.resolve(external, flow, current_user)
    except Exception as exc:  # noqa: BLE001 — 콜백은 항상 302 로 끝낸다. 로그에는 예외 타입만 남긴다
        logger.warning("OAuthCallbackFailed", extra={"error_type": type(exc).__name__})
        return _redirect(error="failed")
    if outcome.error is not None:
        logger.info("OAuthCallbackRejected", extra={"error_code": outcome.error})
        return _redirect(error=outcome.error)
    redirect = _redirect(status_=outcome.status, return_to=flow.return_to)
    if outcome.session_user is not None:
        _set_cookie(redirect, IdentityService.issue_token(outcome.session_user))
    return redirect

