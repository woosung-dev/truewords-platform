"""구글 OIDC 테스트 공용 도구 — 테스트용 RSA 키, RS256 ID token 서명, JWKS/토큰 엔드포인트 MockTransport.

실제 네트워크는 절대 호출하지 않는다. `FakeGoogle.transport` 가 받은 요청은 `calls` 에 쌓인다.
``tests/`` 가 sys.path 에 앉으므로 ``from oidc_support import ...`` 로 가져온다.
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt
from pydantic import SecretStr

from app.modules.identity.oidc import OidcConfig, OidcProvider, google_config, map_google_claims

CLIENT_ID = "test-client-id.apps.googleusercontent.com"
CLIENT_SECRET = "test-client-secret"
ISSUER = "https://accounts.google.com"


def _b64(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@dataclass
class SigningKey:
    kid: str
    private_pem: str
    jwk: dict[str, str]

    @classmethod
    def generate(cls, kid: str) -> "SigningKey":
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = private.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ).decode()
        numbers = private.public_key().public_numbers()
        jwk = {"kty": "RSA", "alg": "RS256", "use": "sig", "kid": kid, "n": _b64(numbers.n), "e": _b64(numbers.e)}
        return cls(kid=kid, private_pem=pem, jwk=jwk)


# 키 생성은 느리므로 모듈 전역에서 한 번만 만든다. 서명 키·다른 키·JWKS 교체용 키.
KEY = SigningKey.generate("kid-1")
OTHER_KEY = SigningKey.generate("kid-other")
ROTATED_KEY = SigningKey.generate("kid-2")


DROP = object()  # make_claims(aud=DROP) 처럼 클레임을 아예 빼는 표식


def make_claims(nonce: Any = "nonce-abc", **overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "azp": CLIENT_ID,
        "sub": "google-sub-1",
        "email": "person@gmail.com",
        "email_verified": True,
        "name": "홍길동",
        "given_name": "길동",
        "nonce": nonce,
        "iat": now,
        "exp": now + 600,
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not DROP}



def sign_rs256(claims: dict[str, Any], key: SigningKey = KEY, *, kid: str | None = None) -> str:
    return jwt.encode(claims, key.private_pem, algorithm="RS256", headers={"kid": kid or key.kid})


def forge(header: dict[str, Any], claims: dict[str, Any], signature: bytes = b"") -> str:
    """서명 검증을 통과할 수 없는 수제 토큰(alg=none·HS256 등)."""
    import json

    def enc(obj: Any) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{enc(header)}.{enc(claims)}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


@dataclass
class FakeGoogle:
    """토큰·JWKS 엔드포인트 MockTransport. `id_token_factory(nonce)` 가 토큰 엔드포인트가 돌려줄 id_token 을 만든다."""

    keys: list[SigningKey] = field(default_factory=lambda: [KEY])
    id_token_factory: Any = None  # callable(nonce:str)->str, 호출 시점에 nonce 를 모르면 test 가 직접 id_token 지정
    id_token: str | None = None
    token_status: int = 200
    token_calls: list[dict[str, list[str]]] = field(default_factory=list)
    jwks_calls: int = 0
    requests: list[httpx.Request] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "oauth2.googleapis.com":
            self.token_calls.append(parse_qs(request.content.decode()))
            if self.token_status != 200:
                return httpx.Response(self.token_status, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"id_token": self.id_token, "access_token": "at", "token_type": "Bearer"})
        if request.url.host == "www.googleapis.com":
            self.jwks_calls += 1
            return httpx.Response(200, json={"keys": [k.jwk for k in self.keys]})
        raise AssertionError(f"예상 밖 네트워크 호출: {request.url}")

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def provider(self, config: OidcConfig | None = None) -> OidcProvider:
        cfg = config or google_config(CLIENT_ID, SecretStr(CLIENT_SECRET))
        return OidcProvider(cfg, map_google_claims, transport=self.transport)
