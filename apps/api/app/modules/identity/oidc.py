"""외부 로그인 제공자(OIDC) 추상화 — Authorization Code + PKCE, ID token 은 JWKS 로 서명 검증한다.

제공자 하나를 붙이는 일은 `OidcConfig` + claims 매핑 함수 하나다(구글: `map_google_claims`).
Authlib 대신 python-jose + httpx 로 구현한다(앱에 SessionMiddleware 가 없다).
로그에는 예외 타입만 남기고 코드·토큰·이메일 원문은 남기지 않는다.
"""

from __future__ import annotations

import hmac
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx
from jose import JWTError, jwt
from pydantic import SecretStr

from app.core.config import Settings

GOOGLE_PROVIDER = "google"
GOOGLE_ISSUER = "https://accounts.google.com"

JWKS_TTL_SECONDS = 3600.0
HTTP_TIMEOUT_SECONDS = 10.0
CLOCK_LEEWAY_SECONDS = 30
_ALLOWED_ALGORITHMS = ["RS256"]  # 알고리즘은 고정한다 — 토큰 헤더의 alg 를 따르지 않는다(HS256 혼동·none 공격 방지)


class OidcError(Exception):
    """제공자 통신·ID token 검증 실패. 메시지에 토큰·코드·이메일을 담지 않는다."""


@dataclass(frozen=True)
class ExternalIdentity:
    """제공자가 확인해 준 사용자. 계정 키는 (issuer, subject_scope, subject)이고 이메일은 키가 아니다."""

    provider: str
    issuer: str  # 저장용으로 정규화된 값
    subject_scope: str
    subject: str
    client_id: str
    email: str | None  # 소문자 정규화
    email_verified: bool
    email_authoritative: bool  # 제공자가 이 이메일의 소유를 권위 있게 보증하는지(users.email_verified_* 기록 조건)
    display_name: str | None


@dataclass(frozen=True)
class OidcConfig:
    provider: str
    issuer: str  # 저장·반환용 정규화 issuer
    accepted_issuers: frozenset[str]  # ID token iss 허용 목록
    client_id: str
    client_secret: SecretStr
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    scope: str
    extra_authorization_params: Mapping[str, str] = field(default_factory=dict)
    subject_scope: str = ""  # sub 가 앱 단위인 제공자(카카오 등)만 채운다


ClaimsMapper = Callable[[Mapping[str, Any], OidcConfig], ExternalIdentity]


class LoginProvider(Protocol):
    key: str

    def authorization_url(self, *, redirect_uri: str, state: str, nonce: str, code_challenge: str) -> str: ...

    async def complete(self, *, code: str, redirect_uri: str, code_verifier: str, nonce: str) -> ExternalIdentity: ...


# JWKS 모듈 캐시: jwks_uri → (가져온 시각 monotonic, keys). 테스트는 clear_jwks_cache 로 비운다.
_jwks_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def clear_jwks_cache() -> None:
    _jwks_cache.clear()


class OidcProvider:
    def __init__(
        self,
        config: OidcConfig,
        map_claims: ClaimsMapper,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.config = config
        self.key = config.provider
        self._map_claims = map_claims
        self._transport = transport  # 테스트에서 httpx.MockTransport 를 주입한다

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, transport=self._transport)

    def authorization_url(self, *, redirect_uri: str, state: str, nonce: str, code_challenge: str) -> str:
        params = {
            "response_type": "code",
            "client_id": self.config.client_id,
            "redirect_uri": redirect_uri,
            "scope": self.config.scope,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            **self.config.extra_authorization_params,
        }
        return f"{self.config.authorization_endpoint}?{urlencode(params)}"

    async def complete(self, *, code: str, redirect_uri: str, code_verifier: str, nonce: str) -> ExternalIdentity:
        id_token = await self._exchange_code(code=code, redirect_uri=redirect_uri, code_verifier=code_verifier)
        claims = await self._verify_id_token(id_token, nonce=nonce)
        return self._map_claims(claims, self.config)

    async def _exchange_code(self, *, code: str, redirect_uri: str, code_verifier: str) -> str:
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret.get_secret_value(),
            "code_verifier": code_verifier,
        }
        try:
            async with self._client() as http:
                response = await http.post(self.config.token_endpoint, data=data)
            if response.status_code != 200:
                raise OidcError("token endpoint rejected the request")
            id_token = response.json().get("id_token")
        except httpx.HTTPError:
            raise OidcError("token endpoint unreachable") from None
        except (ValueError, AttributeError):
            raise OidcError("token response malformed") from None
        if not isinstance(id_token, str) or not id_token:
            raise OidcError("id_token missing")
        return id_token

    async def _fetch_jwks(self) -> list[dict[str, Any]]:
        try:
            async with self._client() as http:
                response = await http.get(self.config.jwks_uri)
            if response.status_code != 200:
                raise OidcError("jwks fetch failed")
            keys = response.json().get("keys")
        except httpx.HTTPError:
            raise OidcError("jwks unreachable") from None
        except (ValueError, AttributeError):
            raise OidcError("jwks malformed") from None
        if not isinstance(keys, list):
            raise OidcError("jwks malformed")
        usable = [key for key in keys if isinstance(key, dict)]
        _jwks_cache[self.config.jwks_uri] = (time.monotonic(), usable)
        return usable

    async def _signing_key(self, kid: str) -> dict[str, Any]:
        """kid 로 키를 고른다. 캐시가 낡았으면 다시 받고, 모르는 kid 면 이번 검증에서 한 번만 다시 받는다."""
        cached = _jwks_cache.get(self.config.jwks_uri)
        refetched = False
        if cached is None or time.monotonic() - cached[0] >= JWKS_TTL_SECONDS:
            keys = await self._fetch_jwks()
            refetched = True
        else:
            keys = cached[1]
        key = next((k for k in keys if k.get("kid") == kid), None)
        if key is None and not refetched:
            keys = await self._fetch_jwks()
            key = next((k for k in keys if k.get("kid") == kid), None)
        if key is None:
            raise OidcError("signing key not found")
        return key

    async def _verify_id_token(self, id_token: str, *, nonce: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(id_token)
        except JWTError:
            raise OidcError("id_token malformed") from None
        kid = header.get("kid")
        if header.get("alg") not in _ALLOWED_ALGORITHMS or not isinstance(kid, str) or not kid:
            raise OidcError("id_token header rejected")
        key = await self._signing_key(kid)
        try:
            claims = jwt.decode(
                id_token,
                key,
                algorithms=_ALLOWED_ALGORITHMS,
                audience=self.config.client_id,
                options={
                    "verify_signature": True,
                    "verify_aud": True,
                    "verify_exp": True,
                    "verify_iss": False,  # 허용 목록 검사는 아래에서 직접 한다
                    "verify_at_hash": False,  # access_token 을 쓰지 않는다
                    "require_exp": True,
                    "require_aud": True,
                    "require_iss": True,
                    "require_sub": True,
                    "leeway": CLOCK_LEEWAY_SECONDS,
                },
            )
        except JWTError:
            raise OidcError("id_token verification failed") from None
        if claims.get("iss") not in self.config.accepted_issuers:
            raise OidcError("issuer rejected")
        authorized_party = claims.get("azp")
        if authorized_party is not None and authorized_party != self.config.client_id:
            raise OidcError("azp rejected")
        token_nonce = claims.get("nonce")
        if not isinstance(token_nonce, str) or not hmac.compare_digest(
            token_nonce.encode("utf-8"), nonce.encode("utf-8")
        ):
            raise OidcError("nonce mismatch")
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject or len(subject) > 255:
            raise OidcError("sub rejected")
        return claims


def _claim_true(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.lower() == "true")


def map_google_claims(claims: Mapping[str, Any], config: OidcConfig) -> ExternalIdentity:
    raw_email = claims.get("email")
    email = raw_email.strip().lower() if isinstance(raw_email, str) and raw_email.strip() else None
    email_verified = email is not None and _claim_true(claims.get("email_verified"))
    # gmail.com 주소는 구글이 소유를 보증한다. 그 밖의 주소는 구글 Workspace 도메인(hd 클레임)일 때만 권위가 있다.
    authoritative = bool(email_verified and email is not None and (email.endswith("@gmail.com") or "hd" in claims))
    name = next(
        (str(claims[k]).strip() for k in ("given_name", "name") if isinstance(claims.get(k), str) and claims[k].strip()),
        None,
    )
    return ExternalIdentity(
        provider=config.provider,
        issuer=config.issuer,
        subject_scope=config.subject_scope,
        subject=str(claims["sub"]),
        client_id=config.client_id,
        email=email,
        email_verified=email_verified,
        email_authoritative=authoritative,
        display_name=name,
    )


def google_config(client_id: str, client_secret: SecretStr) -> OidcConfig:
    return OidcConfig(
        provider=GOOGLE_PROVIDER,
        issuer=GOOGLE_ISSUER,
        accepted_issuers=frozenset({GOOGLE_ISSUER, "accounts.google.com"}),
        client_id=client_id,
        client_secret=client_secret,
        authorization_endpoint="https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint="https://oauth2.googleapis.com/token",
        jwks_uri="https://www.googleapis.com/oauth2/v3/certs",
        scope="openid email profile",
        extra_authorization_params={"prompt": "select_account"},
    )


def build_login_providers(
    app_settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None
) -> dict[str, LoginProvider]:
    """설정된 제공자만 담는다. 미설정 제공자는 키가 없어 라우터가 404 OAUTH_PROVIDER_UNAVAILABLE 로 답한다."""
    providers: dict[str, LoginProvider] = {}
    if app_settings.is_hoondok_google_enabled():
        assert app_settings.hoondok_google_client_id is not None
        assert app_settings.hoondok_google_client_secret is not None
        providers[GOOGLE_PROVIDER] = OidcProvider(
            google_config(
                app_settings.hoondok_google_client_id.strip(),
                SecretStr(app_settings.hoondok_google_client_secret.get_secret_value().strip()),
            ),
            map_google_claims,
            transport=transport,
        )
    return providers
