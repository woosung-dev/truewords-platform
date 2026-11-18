"""OAuth 흐름 쿠키(hoondok_oauth)와 return_to 검증 — 제공자 로그인 시작~콜백 사이의 서버 상태.

흐름 쿠키는 기존 admin 서명 키로 만든 10분짜리 HS256 JWT(aud="hoondok-oauth")다.
hoondok_token(aud="hoondok")·admin_token(aud 없음)과 서로 통용되지 않도록 aud 를 명시 검사한다.
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
import uuid
from dataclasses import dataclass
from urllib.parse import urlencode

from app.core.config import settings
from app.modules.admin.auth import create_access_token, decode_access_token

FLOW_COOKIE_NAME = "hoondok_oauth"
FLOW_AUDIENCE = "hoondok-oauth"
FLOW_TTL_SECONDS = 600
RETURN_TO_MAX_LENGTH = 512

# apps/web/src/features/identity/gate.ts 의 safeReturnTo 와 같은 규칙이다.
_LEGACY_PREFIX = re.compile(r"^/hoondok(?=[/?#]|$)")
_ONBOARDING = "/onboarding"
_SAFE_PATH = re.compile(r"^/(?![/\\])")


def _has_control_char(value: str) -> bool:
    return any(ord(ch) <= 0x1F or ord(ch) == 0x7F for ch in value)


def safe_return_to(raw: str | None) -> str:
    """같은 origin 의 절대 경로만 허용한다(open redirect 방지). 통과 못 하면 홈("/")."""
    if not raw or len(raw) > RETURN_TO_MAX_LENGTH or _has_control_char(raw):
        return "/"
    path = _LEGACY_PREFIX.sub("", raw, count=1)
    normalized = f"/{path}" if path == "" or path[0] in "?#" else path
    if normalized.startswith(_ONBOARDING):
        return "/"
    return normalized if _SAFE_PATH.match(normalized) else "/"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def pkce_challenge(verifier: str) -> str:
    """S256: base64url(sha256(verifier)), 패딩 없음."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def redirect_uri(provider: str) -> str:
    base = settings.web_frontend_url.strip().rstrip("/")
    return f"{base}/api/backend/hoondok/auth/oauth/{provider}/callback"


def result_url(*, status: str | None = None, error: str | None = None, return_to: str | None = None) -> str:
    """콜백이 보내는 웹 주소. 성공이면 status(+returnTo), 실패면 error."""
    base = settings.web_frontend_url.strip().rstrip("/")
    params: dict[str, str] = {"status": status} if status else {"error": error or "failed"}
    if status and return_to:
        params["returnTo"] = return_to
    return f"{base}/onboarding/done?{urlencode(params)}"


@dataclass(frozen=True)
class OAuthFlow:
    state: str
    nonce: str
    code_verifier: str
    provider: str
    intent: str  # "login" | "link"
    return_to: str
    link_user_id: uuid.UUID | None
    invite_ok: bool


def encode_flow(flow: OAuthFlow) -> str:
    payload: dict = {
        "aud": FLOW_AUDIENCE,
        "st": flow.state,
        "nn": flow.nonce,
        "cv": flow.code_verifier,
        "p": flow.provider,
        "i": flow.intent,
        "r": flow.return_to,
        "inv": flow.invite_ok,
    }
    if flow.link_user_id is not None:
        payload["u"] = str(flow.link_user_id)
    return create_access_token(payload, expires_minutes=FLOW_TTL_SECONDS // 60)


def decode_flow(token: str | None) -> OAuthFlow | None:
    """위조·만료·aud 불일치(aud 없는 토큰 포함)·필드 누락이면 None.

    python-jose 는 audience 를 넘겨도 토큰에 aud 가 없으면 통과시키므로 aud 를 직접 재검사한다.
    """
    if not token:
        return None
    payload = decode_access_token(token, audience=FLOW_AUDIENCE)
    if payload is None or payload.get("aud") != FLOW_AUDIENCE:
        return None
    try:
        state, nonce, verifier = payload["st"], payload["nn"], payload["cv"]
        provider, intent, return_to = payload["p"], payload["i"], payload["r"]
        if not all(isinstance(v, str) and v for v in (state, nonce, verifier, provider)):
            return None
        if intent not in ("login", "link") or not isinstance(return_to, str):
            return None
        raw_user = payload.get("u")
        link_user_id = uuid.UUID(str(raw_user)) if raw_user is not None else None
    except (KeyError, ValueError):
        return None
    return OAuthFlow(
        state=state,
        nonce=nonce,
        code_verifier=verifier,
        provider=provider,
        intent=intent,
        return_to=safe_return_to(return_to),
        link_user_id=link_user_id,
        invite_ok=payload.get("inv") is True,
    )


def flow_cookie_opts() -> dict:
    """Lax 라서 구글에서 돌아오는 최상위 GET 이동에 쿠키가 실린다. 세션 쿠키와 달리 SameSite=None 이 필요 없다."""
    return {
        "key": FLOW_COOKIE_NAME,
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "path": "/",
    }
