"""훈독 구글 로그인·계정 연결 흐름 — start → callback 전체 경로(실제 OidcProvider + httpx.MockTransport + sqlite 파일 DB).

네트워크는 호출하지 않는다(FakeGoogle 이 토큰·JWKS 엔드포인트를 대신하고, 모르는 호스트는 AssertionError).
DB 는 요청마다 새 세션을 여는 sqlite 파일이고, 검증용 조회·시드는 별도 동기 엔진으로 한다.
계정 키는 (issuer, subject_scope, subject)이며 이메일 병합은 하지 않는다는 요구사항 기준으로 쓴다.
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from pydantic import SecretStr
from sqlalchemy import create_engine, func
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool
from sqlmodel import Session, SQLModel, select

from app.core.common.database import get_async_session
from app.core.config import settings
from app.main import app
from app.modules.admin.auth import create_access_token, hash_password
from app.modules.identity import oauth_flow
from app.modules.identity.dependencies import COOKIE_NAME, get_login_providers, get_user_data_purgers
from app.modules.identity.models import User, UserIdentity
from app.modules.identity.oidc import GOOGLE_ISSUER, clear_jwks_cache
from app.modules.identity.service import IdentityService
from oidc_support import DROP, KEY, OTHER_KEY, FakeGoogle, forge, make_claims, sign_rs256

XHR = {"X-Requested-With": "XMLHttpRequest"}
WEB = "https://app.example.com"
CALLBACK_URI = f"{WEB}/api/backend/hoondok/auth/oauth/google/callback"
START = "/hoondok/auth/oauth/google/start"
CALLBACK = "/hoondok/auth/oauth/google/callback"
FLOW = oauth_flow.FLOW_COOKIE_NAME


class Env:
    def __init__(self, client: TestClient, google: FakeGoogle, sync_engine) -> None:
        self.client = client
        self.google = google
        self.engine = sync_engine
        self.last_code = "auth-code-12345"

    # --- DB 조회·시드 (동기 엔진) ---
    def users(self) -> list[User]:
        with Session(self.engine) as s:
            return list(s.exec(select(User)).all())

    def identities(self) -> list[UserIdentity]:
        with Session(self.engine) as s:
            return list(s.exec(select(UserIdentity)).all())

    def user(self, user_id: uuid.UUID) -> User:
        with Session(self.engine) as s:
            return s.get(User, user_id)

    def counts(self) -> tuple[int, int]:
        return len(self.users()), len(self.identities())

    def add_user(self, email: str, *, password: str | None = "password1", **kw) -> User:
        user = User(email=email.lower(), password_hash=hash_password(password) if password else None, display_name=kw.pop("display_name", "효진"), **kw)
        with Session(self.engine) as s:
            s.add(user)
            s.commit()
            s.refresh(user)
        return user

    def add_identity(self, user: User, sub: str = "google-sub-1", email: str | None = None) -> UserIdentity:
        identity = UserIdentity(
            user_id=user.id, provider="google", issuer=GOOGLE_ISSUER, subject=sub, client_id="cid", email=email, email_verified=True
        )
        with Session(self.engine) as s:
            s.add(identity)
            s.commit()
            s.refresh(identity)
        return identity

    # --- 쿠키 ---
    def cookies(self, *, session_for: User | None = None, flow: str | None = None) -> None:
        """클라이언트의 쿠키를 통째로 갈아 끼운다(같은 이름 쿠키 도메인 충돌 방지)."""
        self.client.cookies.clear()
        if session_for is not None:
            self.client.cookies.set(COOKIE_NAME, IdentityService.issue_token(session_for))
        if flow is not None:
            self.client.cookies.set(FLOW, flow)

    def login_as(self, user: User) -> None:
        self.cookies(session_for=user)

    # --- 흐름 ---
    def start(self, intent: str = "login", **body):
        res = self.client.post(START, json={"intent": intent, **body}, headers=XHR)
        return res

    def start_ok(self, intent: str = "login", **body) -> dict:
        res = self.start(intent, **body)
        assert res.status_code == 200, res.text
        url = res.json()["authorization_url"]
        q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        q["_flow_cookie"] = self.client.cookies.get(FLOW)
        return q

    def callback(self, q: dict, *, claims: dict | None = None, id_token: str | None = None, **params):
        """제공자 로그인이 끝난 척 콜백을 친다. id_token 을 주지 않으면 q 의 nonce 로 정상 토큰을 만든다."""
        if id_token is None:
            id_token = sign_rs256(make_claims(q["nonce"], **(claims or {})))
        self.google.id_token = id_token
        query = {"code": self.last_code, "state": q["state"], **params}
        return self.client.get(CALLBACK, params={k: v for k, v in query.items() if v is not None}, follow_redirects=False)

    def run(self, intent: str = "login", *, claims: dict | None = None, start_body: dict | None = None):
        q = self.start_ok(intent, **(start_body or {}))
        return self.callback(q, claims=claims)


def location(res) -> tuple[str, dict]:
    assert res.status_code == 302, res.text
    parts = urlsplit(res.headers["location"])
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == f"{WEB}/onboarding/done"
    return parts.path, {k: v[0] for k, v in parse_qs(parts.query).items()}


def outcome(res) -> str:
    _, q = location(res)
    return q.get("status") or "error=" + q["error"]


def set_cookies(res) -> list[str]:
    return res.headers.get_list("set-cookie")


def session_cookie_issued(res) -> bool:
    return any(c.startswith(f"{COOKIE_NAME}=") and "Max-Age=0" not in c for c in set_cookies(res))


def flow_cookie_deleted(res) -> bool:
    return any(c.startswith(f"{FLOW}=") and "Max-Age=0" in c for c in set_cookies(res))


@pytest.fixture
def env(tmp_path, monkeypatch):
    path = tmp_path / "oauth.db"
    sync_engine = create_engine(f"sqlite:///{path}")
    SQLModel.metadata.create_all(sync_engine, tables=[User.__table__, UserIdentity.__table__])
    async_engine = create_async_engine(f"sqlite+aiosqlite:///{path}", poolclass=NullPool)

    async def _session():
        async with AsyncSession(async_engine, expire_on_commit=False) as session:
            yield session

    google = FakeGoogle()
    provider = google.provider()
    monkeypatch.setattr(settings, "web_frontend_url", WEB + "/")
    monkeypatch.setattr(settings, "cookie_secure", False)
    clear_jwks_cache()
    app.dependency_overrides[get_async_session] = _session
    app.dependency_overrides[get_login_providers] = lambda: {"google": provider, "kakao": provider}
    app.dependency_overrides[get_user_data_purgers] = lambda: []
    try:
        yield Env(TestClient(app), google, sync_engine)
    finally:
        for dep in (get_async_session, get_login_providers, get_user_data_purgers):
            app.dependency_overrides.pop(dep, None)
        clear_jwks_cache()
        sync_engine.dispose()


# =============================== start ===============================


def test_start_returns_authorization_url_and_flow_cookie(env: Env):
    res = env.start("login")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "no-store"
    cookie = next(c for c in set_cookies(res) if c.startswith(f"{FLOW}="))
    assert "HttpOnly" in cookie and "Max-Age=600" in cookie and "Path=/" in cookie
    assert "samesite=lax" in cookie.lower() and "secure" not in cookie.lower()

    url = res.json()["authorization_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
    assert q["redirect_uri"] == CALLBACK_URI  # 끝 슬래시 제거된 고정 값
    assert q["prompt"] == "select_account" and q["code_challenge_method"] == "S256" and q["response_type"] == "code"

    claims = jwt.get_unverified_claims(env.client.cookies.get(FLOW))
    assert claims["aud"] == "hoondok-oauth"
    assert 590 <= claims["exp"] - time.time() <= 601  # 10분
    assert claims["st"] == q["state"] and claims["nn"] == q["nonce"]
    # PKCE: challenge = b64url(sha256(verifier)), verifier 는 URL 에 없다
    assert q["code_challenge"] == oauth_flow.pkce_challenge(claims["cv"])
    assert claims["cv"] not in url
    assert claims["i"] == "login" and claims["p"] == "google" and "u" not in claims


def test_start_flow_cookie_is_secure_when_configured(env: Env, monkeypatch):
    monkeypatch.setattr(settings, "cookie_secure", True)
    cookie = next(c for c in set_cookies(env.start("login")) if c.startswith(f"{FLOW}="))
    assert "Secure" in cookie and "samesite=lax" in cookie.lower()


def test_start_uses_fresh_state_nonce_and_verifier_each_time(env: Env):
    a, b = env.start_ok(), env.start_ok()
    assert len({a["state"], b["state"], a["nonce"], b["nonce"]}) == 4
    assert a["code_challenge"] != b["code_challenge"]


def test_start_requires_csrf_header(env: Env):
    assert env.client.post(START, json={"intent": "login"}).status_code == 403


def test_start_rejects_unknown_intent(env: Env):
    assert env.client.post(START, json={"intent": "signup"}, headers=XHR).status_code == 422


@pytest.mark.parametrize("provider", ["kakao-unknown", "apple", "GOOGLE"])
def test_start_unregistered_provider_is_404(env: Env, provider: str):
    res = env.client.post(f"/hoondok/auth/oauth/{provider}/start", json={"intent": "login"}, headers=XHR)
    assert res.status_code == 404 and res.json()["error_code"] == "OAUTH_PROVIDER_UNAVAILABLE"
    assert not any(c.startswith(f"{FLOW}=") for c in set_cookies(res))


def test_start_unconfigured_google_is_404(env: Env):
    app.dependency_overrides[get_login_providers] = lambda: {}
    res = env.start("login")
    assert res.status_code == 404 and res.json()["error_code"] == "OAUTH_PROVIDER_UNAVAILABLE"


def test_start_link_without_session_is_401_and_sets_no_cookie(env: Env):
    res = env.start("link")
    assert res.status_code == 401
    assert not any(c.startswith(f"{FLOW}=") for c in set_cookies(res))


def test_start_link_with_session_binds_user_into_flow(env: Env):
    user = env.add_user("a@example.com")
    env.login_as(user)
    env.start_ok("link")
    claims = jwt.get_unverified_claims(env.client.cookies.get(FLOW))
    assert claims["i"] == "link" and claims["u"] == str(user.id)


def test_start_login_does_not_bind_user_even_if_session_exists(env: Env):
    env.login_as(env.add_user("a@example.com"))
    env.start_ok("login")
    assert "u" not in jwt.get_unverified_claims(env.client.cookies.get(FLOW))


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("/words/1-2?x=1", "/words/1-2?x=1"),
        ("/hoondok/bookmark", "/bookmark"),  # 옛 접두는 걷어 낸다
        ("//evil.example.com", "/"),
        ("/\\evil.example.com", "/"),
        ("https://evil.example.com/x", "/"),
        ("evil.example.com", "/"),
        ("/ok\r\nSet-Cookie: x=1", "/"),
        ("/ok\x00", "/"),
        ("/ok\x7f", "/"),
        ("/onboarding", "/"),
        ("/onboarding/done?status=signed_in", "/"),
        ("/hoondok/onboarding", "/"),
        ("/hoondok//evil.example.com", "/"),
        ("/" + "a" * 600, "/"),
        ("", "/"),
        (None, "/"),
    ],
)
def test_start_return_to_is_sanitized(env: Env, raw, expected):
    env.start_ok("login", return_to=raw)
    assert jwt.get_unverified_claims(env.client.cookies.get(FLOW))["r"] == expected


def test_start_invite_flag_in_flow_cookie(env: Env, monkeypatch):
    def invite_ok(code):
        res = env.start("login", invite_code=code)
        assert res.status_code == 200  # 틀린 코드도 막지 않는다
        return jwt.get_unverified_claims(env.client.cookies.get(FLOW))["inv"]

    assert invite_ok(None) is True  # 게이트 OFF
    monkeypatch.setattr(settings, "hoondok_invite_code", SecretStr("새벽-2026"))
    assert invite_ok(None) is False
    assert invite_ok("wrong") is False
    assert invite_ok(" 새벽-2026 ") is True


# =============================== callback: 흐름 쿠키·state ===============================


def _flow_claims(env: Env, **start_body) -> tuple[dict, dict]:
    q = env.start_ok("login", **start_body)
    return q, jwt.get_unverified_claims(q["_flow_cookie"])


def _sign_hs256(claims: dict, secret: str | None = None) -> str:
    return jwt.encode(claims, secret or settings.admin_jwt_secret.get_secret_value(), algorithm=settings.admin_jwt_algorithm)


def _assert_failed_without_calls(env: Env, res, expected: str = "error=failed") -> None:
    assert outcome(res) == expected
    assert flow_cookie_deleted(res)
    assert not session_cookie_issued(res)
    assert env.google.requests == [] and env.google.token_calls == []  # 토큰 엔드포인트·JWKS 호출 0회
    assert env.counts() == (0, 0)


def test_callback_without_flow_cookie_fails_without_token_call(env: Env):
    q = env.start_ok()
    env.cookies()  # 흐름 쿠키 제거
    _assert_failed_without_calls(env, env.callback(q))


def test_callback_with_garbage_flow_cookie_fails(env: Env):
    q = env.start_ok()
    env.cookies(flow="not-a-jwt")
    _assert_failed_without_calls(env, env.callback(q))


def test_callback_with_expired_flow_cookie_fails(env: Env):
    q, claims = _flow_claims(env)
    env.cookies(flow=_sign_hs256({**claims, "exp": int(time.time()) - 5}))
    _assert_failed_without_calls(env, env.callback(q))


def test_callback_with_flow_cookie_signed_by_other_key_fails(env: Env):
    q, claims = _flow_claims(env)
    env.cookies(flow=_sign_hs256(claims, secret="attacker-secret-key-0123456789abcdef"))
    _assert_failed_without_calls(env, env.callback(q))


def test_callback_with_flow_cookie_without_aud_fails(env: Env):
    """aud 가 없는 토큰(admin_token 형태)은 jose 가 통과시키므로 명시 재검사가 필요하다."""
    q, claims = _flow_claims(env)
    claims.pop("aud")
    env.cookies(flow=_sign_hs256(claims))
    _assert_failed_without_calls(env, env.callback(q))


def test_callback_with_wrong_aud_flow_cookie_fails(env: Env):
    q, claims = _flow_claims(env)
    env.cookies(flow=_sign_hs256({**claims, "aud": "hoondok"}))
    _assert_failed_without_calls(env, env.callback(q))


def test_callback_with_session_token_as_flow_cookie_fails(env: Env):
    q = env.start_ok()
    user = env.add_user("a@example.com")
    env.cookies(flow=IdentityService.issue_token(user))
    _assert_failed_without_calls_except_user(env, env.callback(q))


def test_callback_with_admin_token_as_flow_cookie_fails(env: Env):
    q = env.start_ok()
    env.cookies(flow=create_access_token({"sub": str(uuid.uuid4()), "role": "admin", "email": "a@b.c"}))
    _assert_failed_without_calls(env, env.callback(q))


def _assert_failed_without_calls_except_user(env: Env, res) -> None:
    """시드한 user 1명이 있어 counts 가 (1, 0)인 경우."""
    assert outcome(res) == "error=failed" and flow_cookie_deleted(res) and not session_cookie_issued(res)
    assert env.google.requests == [] and env.counts() == (1, 0)


def test_flow_cookie_is_not_accepted_as_session_cookie(env: Env):
    env.start_ok()
    env.cookies(flow=env.client.cookies.get(FLOW))
    env.client.cookies.set(COOKIE_NAME, env.client.cookies.get(FLOW))
    assert env.client.get("/hoondok/auth/me").status_code == 401


def test_callback_with_provider_mismatch_fails_without_token_call(env: Env):
    q = env.start_ok()  # 흐름은 google 용
    res = env.client.get(
        "/hoondok/auth/oauth/kakao/callback", params={"code": "c", "state": q["state"]}, follow_redirects=False
    )
    _assert_failed_without_calls(env, res)


def test_callback_for_unregistered_provider_still_redirects(env: Env):
    q = env.start_ok()
    res = env.client.get(
        "/hoondok/auth/oauth/apple/callback", params={"code": "c", "state": q["state"]}, follow_redirects=False
    )
    _assert_failed_without_calls(env, res)


@pytest.mark.parametrize("state", ["wrong-state", "", None])
def test_callback_with_state_mismatch_or_missing_fails_without_token_call(env: Env, state):
    env.start_ok()
    res = env.client.get(CALLBACK, params={"code": "c", **({"state": state} if state is not None else {})}, follow_redirects=False)
    _assert_failed_without_calls(env, res)


def test_callback_error_access_denied_is_cancelled_without_token_call(env: Env):
    q = env.start_ok()
    res = env.client.get(CALLBACK, params={"error": "access_denied", "state": q["state"]}, follow_redirects=False)
    assert outcome(res) == "error=cancelled" and flow_cookie_deleted(res)
    assert env.google.requests == [] and env.counts() == (0, 0)


def test_callback_error_with_bad_state_is_failed_not_cancelled(env: Env):
    env.start_ok()
    res = env.client.get(CALLBACK, params={"error": "access_denied", "state": "forged"}, follow_redirects=False)
    assert outcome(res) == "error=failed"


def test_callback_without_code_fails_without_token_call(env: Env):
    q = env.start_ok()
    res = env.client.get(CALLBACK, params={"state": q["state"]}, follow_redirects=False)
    assert outcome(res) == "error=failed" and env.google.requests == []


def test_callback_response_headers_and_flow_cookie_removed_on_success(env: Env):
    res = env.run()
    assert res.status_code == 302
    assert res.headers["cache-control"] == "no-store" and res.headers["referrer-policy"] == "no-referrer"
    assert flow_cookie_deleted(res)
    env.client.get("/hoondok/auth/me")
    assert env.client.cookies.get(FLOW) is None


def test_flow_cookie_replay_after_callback_is_not_possible_via_browser_cookie_jar(env: Env):
    q = env.start_ok()
    env.callback(q)
    res = env.callback(q)  # 쿠키 항아리에서 흐름 쿠키가 지워졌으므로 두 번째 콜백은 실패한다
    assert outcome(res) == "error=failed"
    assert len(env.google.token_calls) == 1


# =============================== callback: ID token 검증 실패 ===============================


def _bad_tokens() -> dict[str, dict]:
    return {
        "other-key": {"sign_key": OTHER_KEY, "kid": KEY.kid},
        "iss": {"claims": {"iss": "https://evil.example.com"}},
        "aud": {"claims": {"aud": "other-client"}},
        "azp": {"claims": {"azp": "other-client"}},
        "expired": {"claims": {"exp": int(time.time()) - 3600}},
        "nonce": {"claims": {"nonce": "different"}},
    }


@pytest.mark.parametrize("case", list(_bad_tokens()))
def test_callback_with_invalid_id_token_fails_and_changes_nothing(env: Env, case: str):
    spec = _bad_tokens()[case]
    q = env.start_ok()
    claims = make_claims(**{"nonce": q["nonce"], **spec.get("claims", {})})
    token = sign_rs256(claims, spec.get("sign_key", KEY), kid=spec.get("kid"))
    res = env.callback(q, id_token=token)
    assert outcome(res) == "error=failed" and flow_cookie_deleted(res) and not session_cookie_issued(res)
    assert env.counts() == (0, 0)
    assert len(env.google.token_calls) == 1  # 코드 교환까지는 갔지만 검증에서 막혔다


@pytest.mark.parametrize("alg", ["HS256", "none"])
def test_callback_with_hs256_or_none_alg_id_token_fails(env: Env, alg: str):
    q = env.start_ok()
    token = forge({"alg": alg, "typ": "JWT", "kid": KEY.kid}, make_claims(q["nonce"]), b"k" * 32 if alg != "none" else b"")
    res = env.callback(q, id_token=token)
    assert outcome(res) == "error=failed" and env.counts() == (0, 0) and not session_cookie_issued(res)


def test_callback_when_token_endpoint_rejects_code_fails(env: Env):
    q = env.start_ok()
    env.google.token_status = 400
    res = env.callback(q, id_token="x")
    assert outcome(res) == "error=failed" and env.counts() == (0, 0)


def test_callback_unverified_email_is_email_unverified_and_creates_nothing(env: Env):
    res = env.run(claims={"email_verified": False})
    assert outcome(res) == "error=email_unverified" and not session_cookie_issued(res)
    assert env.counts() == (0, 0)


def test_callback_token_request_carries_verifier_and_fixed_redirect_uri(env: Env):
    q = env.start_ok()
    verifier = jwt.get_unverified_claims(q["_flow_cookie"])["cv"]
    assert outcome(env.callback(q)) == "created"
    body = env.google.token_calls[0]
    assert body["code_verifier"] == [verifier] and body["redirect_uri"] == [CALLBACK_URI]
    assert body["code"] == [env.last_code]


# =============================== callback: 로그인 ===============================


def test_existing_identity_login_signs_in_same_user_without_new_rows(env: Env):
    user = env.add_user("someone@example.com", password=None)
    env.add_identity(user, "google-sub-1")
    before = env.counts()
    res = env.run(claims={"email": "changed@gmail.com"}, start_body={"return_to": "/words/3"})
    path, q = location(res)
    assert q == {"status": "signed_in", "returnTo": "/words/3"}
    assert env.counts() == before == (1, 1)
    assert session_cookie_issued(res)
    me = env.client.get("/hoondok/auth/me")
    assert me.status_code == 200 and me.json()["user"]["id"] == str(user.id)
    # 이메일이 바뀌어도 계정 이메일은 건드리지 않는다(이메일은 키가 아니다), identity 힌트만 갱신
    assert env.user(user.id).email == "someone@example.com"
    assert env.identities()[0].email == "changed@gmail.com" and env.identities()[0].last_login_at is not None


def test_existing_identity_login_ignores_invite_gate(env: Env, monkeypatch):
    user = env.add_user("someone@example.com", password=None)
    env.add_identity(user)
    monkeypatch.setattr(settings, "hoondok_invite_code", SecretStr("새벽-2026"))
    res = env.run(start_body={"invite_code": "틀림"})
    assert outcome(res) == "signed_in" and session_cookie_issued(res)


def test_login_with_same_email_as_existing_account_is_email_exists_even_if_case_differs(env: Env):
    existing = env.add_user("Person@Gmail.com", password="password1")  # 저장 시 소문자
    res = env.run(claims={"email": "PERSON@gmail.COM"})
    assert outcome(res) == "error=email_exists"
    assert not session_cookie_issued(res)
    assert env.counts() == (1, 0)  # 계정도 identity 도 만들지 않는다
    assert env.user(existing.id).password_hash is not None  # 기존 계정은 그대로


def test_email_exists_does_not_authenticate_even_with_existing_session_of_other_user(env: Env):
    env.add_user("person@gmail.com")
    other = env.add_user("other@example.com")
    env.login_as(other)
    q = env.start_ok("login")
    res = env.callback(q)
    assert outcome(res) == "error=email_exists" and not session_cookie_issued(res)


def test_new_google_user_is_created_with_identity_and_no_password(env: Env):
    res = env.run(claims={"email": "New.Person@Gmail.com", "sub": "sub-new", "given_name": DROP, "name": "새 사람"})
    assert outcome(res) == "created" and session_cookie_issued(res)
    (user,) = env.users()
    (identity,) = env.identities()
    assert user.password_hash is None and user.email == "new.person@gmail.com" and user.display_name == "새 사람"
    assert user.deleted_at is None and user.consented_at is None
    # gmail 은 권위 있는 이메일 — 확인 기록이 남는다
    assert user.email_verified_at is not None and user.email_verified_by == GOOGLE_ISSUER
    assert (identity.provider, identity.issuer, identity.subject_scope, identity.subject) == ("google", GOOGLE_ISSUER, "", "sub-new")
    assert identity.user_id == user.id and identity.email == "new.person@gmail.com" and identity.email_verified is True
    me = env.client.get("/hoondok/auth/me").json()["user"]
    assert me["id"] == str(user.id)
    assert [m["provider"] for m in me["login_methods"]] == ["google"]  # 비밀번호 수단 없음


def test_new_user_from_non_authoritative_domain_has_no_email_verification_record(env: Env):
    assert outcome(env.run(claims={"email": "me@naver.com"})) == "created"
    assert env.users()[0].email_verified_at is None and env.users()[0].email_verified_by is None


def test_new_user_display_name_fallback_and_truncation(env: Env):
    assert outcome(env.run(claims={"given_name": DROP, "name": DROP, "sub": "s1", "email": "a1@gmail.com"})) == "created"
    assert outcome(env.run(claims={"given_name": "가" * 100, "sub": "s2", "email": "a2@gmail.com"})) == "created"
    names = {u.email: u.display_name for u in env.users()}
    assert names["a1@gmail.com"] == "식구" and names["a2@gmail.com"] == "가" * 64


def test_login_with_invite_gate_requires_valid_code_given_at_start(env: Env, monkeypatch):
    monkeypatch.setattr(settings, "hoondok_invite_code", SecretStr("새벽-2026"))
    res = env.run(claims={"sub": "s1", "email": "a1@gmail.com"})
    assert outcome(res) == "error=invite_required" and not session_cookie_issued(res)
    res = env.run(claims={"sub": "s1", "email": "a1@gmail.com"}, start_body={"invite_code": "틀림"})
    assert outcome(res) == "error=invite_required"
    assert env.counts() == (0, 0)
    res = env.run(claims={"sub": "s1", "email": "a1@gmail.com"}, start_body={"invite_code": "새벽-2026"})
    assert outcome(res) == "created" and env.counts() == (1, 1)


def test_invite_flag_cannot_be_forged_through_callback_query(env: Env, monkeypatch):
    """invite_ok 는 흐름 쿠키에만 있다 — 콜백 쿼리로 우회할 수 없다."""
    monkeypatch.setattr(settings, "hoondok_invite_code", SecretStr("새벽-2026"))
    q = env.start_ok()
    res = env.callback(q, invite_code="새벽-2026", inv="true")
    assert outcome(res) == "error=invite_required"


def test_identity_pointing_to_deleted_user_is_removed_and_signup_proceeds(env: Env):
    old = env.add_user("x@example.com", password=None, deleted_at=datetime.now(timezone.utc))
    env.add_identity(old, "google-sub-1")
    res = env.run()
    assert outcome(res) == "created"
    (identity,) = env.identities()
    assert identity.user_id != old.id and identity.subject == "google-sub-1"
    users = {u.id: u for u in env.users()}
    assert len(users) == 2 and users[identity.user_id].deleted_at is None
    assert env.client.get("/hoondok/auth/me").json()["user"]["id"] == str(identity.user_id)


# =============================== callback: 연결(link) ===============================


def test_link_attaches_google_clears_password_and_blocks_password_login(env: Env):
    user = env.add_user("a@example.com", password="password1")
    env.login_as(user)
    res = env.run("link", claims={"email": "other@gmail.com", "sub": "sub-a"})
    assert outcome(res) == "linked" and not session_cookie_issued(res)
    (identity,) = env.identities()
    assert identity.user_id == user.id and identity.subject == "sub-a"
    assert env.user(user.id).password_hash is None
    me = env.client.get("/hoondok/auth/me").json()["user"]
    assert [m["provider"] for m in me["login_methods"]] == ["google"]
    login = env.client.post("/hoondok/auth/login", json={"email": "a@example.com", "password": "password1"}, headers=XHR)
    assert login.status_code == 401  # 500 이 아니다
    assert env.counts() == (1, 1)


def test_link_to_other_users_google_is_already_linked_and_moves_nothing(env: Env):
    owner = env.add_user("owner@gmail.com", password=None)
    env.add_identity(owner, "sub-shared")
    me = env.add_user("me@example.com", password="password1")
    env.login_as(me)
    res = env.run("link", claims={"sub": "sub-shared"})
    assert outcome(res) == "error=already_linked"
    (identity,) = env.identities()
    assert identity.user_id == owner.id
    assert env.user(me.id).password_hash is not None
    assert env.client.get("/hoondok/auth/me").json()["user"]["id"] == str(me.id)  # 세션은 그대로


def test_link_when_session_user_changed_after_start_is_session_mismatch(env: Env):
    a = env.add_user("a@example.com")
    b = env.add_user("b@example.com")
    env.login_as(a)
    q = env.start_ok("link")
    flow = env.client.cookies.get(FLOW)
    env.cookies(session_for=b, flow=flow)  # 시작 이후 다른 계정으로 로그인한 브라우저
    res = env.callback(q)
    assert outcome(res) == "error=session_mismatch" and not session_cookie_issued(res)
    assert env.identities() == []
    assert env.user(a.id).password_hash is not None and env.user(b.id).password_hash is not None


def test_link_without_session_at_callback_is_session_mismatch(env: Env):
    a = env.add_user("a@example.com")
    env.login_as(a)
    q = env.start_ok("link")
    env.cookies(flow=env.client.cookies.get(FLOW))  # 세션 쿠키 없이 콜백(login CSRF 시나리오)
    res = env.callback(q)
    assert outcome(res) == "error=session_mismatch" and env.identities() == []


def test_link_session_mismatch_wins_over_already_linked(env: Env):
    owner = env.add_user("owner@gmail.com", password=None)
    env.add_identity(owner, "sub-shared")
    a, b = env.add_user("a@example.com"), env.add_user("b@example.com")
    env.login_as(a)
    q = env.start_ok("link")
    env.cookies(session_for=b, flow=env.client.cookies.get(FLOW))
    assert outcome(env.callback(q, claims={"sub": "sub-shared"})) == "error=session_mismatch"


def test_link_with_unverified_email_changes_nothing(env: Env):
    a = env.add_user("a@example.com")
    env.login_as(a)
    assert outcome(env.run("link", claims={"email_verified": False})) == "error=email_unverified"
    assert env.identities() == [] and env.user(a.id).password_hash is not None


@pytest.mark.parametrize(
    "account_email, claims, recorded",
    [
        ("person@gmail.com", {"email": "Person@Gmail.com"}, True),  # gmail 은 권위 있다
        ("staff@church.example", {"email": "staff@church.example", "hd": "church.example"}, True),  # Workspace(hd)
        ("me@naver.com", {"email": "me@naver.com"}, False),  # hd 없는 외부 도메인
        ("a@example.com", {"email": "person@gmail.com"}, False),  # 계정 이메일과 다름
    ],
    ids=["gmail", "workspace-hd", "foreign-domain", "email-differs"],
)
def test_link_records_email_verification_only_when_authoritative_and_equal(env: Env, account_email, claims, recorded):
    user = env.add_user(account_email)
    env.login_as(user)
    assert outcome(env.run("link", claims=claims)) == "linked"
    stored = env.user(user.id)
    if recorded:
        assert stored.email_verified_at is not None and stored.email_verified_by == GOOGLE_ISSUER
    else:
        assert stored.email_verified_at is None and stored.email_verified_by is None


def test_link_picks_up_identity_of_deleted_user_and_attaches_to_session_user(env: Env):
    old = env.add_user("x@example.com", password=None, deleted_at=datetime.now(timezone.utc))
    env.add_identity(old, "google-sub-1")
    me = env.add_user("me@example.com")
    env.login_as(me)
    assert outcome(env.run("link")) == "linked"
    (identity,) = env.identities()
    assert identity.user_id == me.id


def _blind_first_lookup(monkeypatch, *, email_lookup: bool = False) -> None:
    """첫 조회만 '아직 없음'으로 속여, 동시 요청이 먼저 행을 만든 경쟁 상황(unique 충돌)을 흉내 낸다."""
    from app.modules.identity.repository import UserIdentityRepository, UserRepository

    real_subject = UserIdentityRepository.get_by_subject
    state = {"subject": 0, "email": 0}

    async def get_by_subject(self, issuer, scope, subject):
        state["subject"] += 1
        return None if state["subject"] == 1 else await real_subject(self, issuer, scope, subject)

    monkeypatch.setattr(UserIdentityRepository, "get_by_subject", get_by_subject)
    if email_lookup:
        real_email = UserRepository.get_by_email

        async def get_by_email(self, email):
            state["email"] += 1
            return None if state["email"] == 1 else await real_email(self, email)

        monkeypatch.setattr(UserRepository, "get_by_email", get_by_email)


def test_first_login_race_recovers_to_signed_in_with_existing_rows(env: Env, monkeypatch):
    user = env.add_user("person@gmail.com", password=None)
    env.add_identity(user, "google-sub-1")
    _blind_first_lookup(monkeypatch, email_lookup=True)
    res = env.run()
    assert outcome(res) == "signed_in" and session_cookie_issued(res)
    assert env.counts() == (1, 1)


def _link_race(env: Env, monkeypatch):
    owner = env.add_user("owner@gmail.com", password=None)
    env.add_identity(owner, "google-sub-1")
    me = env.add_user("me@example.com", password="password1")
    env.login_as(me)
    _blind_first_lookup(monkeypatch)
    return owner, me, env.run("link")


def test_link_race_on_subject_conflict_leaves_db_consistent(env: Env, monkeypatch):
    owner, me, res = _link_race(env, monkeypatch)
    assert outcome(res).startswith("error=") and not session_cookie_issued(res)
    assert env.user(me.id).password_hash is not None  # 롤백으로 해시 제거가 취소돼야 한다
    assert len(env.identities()) == 1 and env.identities()[0].user_id == owner.id


@pytest.mark.xfail(
    strict=True,
    reason="결함: oauth_service._after_race 가 롤백으로 만료된 current_user.id 를 읽어 MissingGreenlet 이 나고 "
    "콜백이 already_linked 대신 error=failed 로 끝난다(oauth_service.py:149). 연결 경쟁 시 원인 불명 오류로 보인다.",
)
def test_link_race_on_subject_conflict_reports_already_linked(env: Env, monkeypatch):
    _, _, res = _link_race(env, monkeypatch)
    assert outcome(res) == "error=already_linked"


def test_callback_ignores_extra_query_params_sent_by_google(env: Env):
    q = env.start_ok()
    res = env.callback(q, scope="email profile openid", authuser="0", prompt="none", hd="example.com", iss="https://accounts.google.com")
    assert outcome(res) == "created"


# =============================== 로그인 수단 해제 ===============================


def test_delete_identity_last_method_is_409(env: Env):
    user = env.add_user("g@gmail.com", password=None)
    identity = env.add_identity(user)
    env.login_as(user)
    res = env.client.delete(f"/hoondok/auth/identities/{identity.id}", headers=XHR)
    assert res.status_code == 409 and res.json()["error_code"] == "LAST_LOGIN_METHOD"
    assert len(env.identities()) == 1


def test_delete_identity_with_other_method_remaining_is_204(env: Env):
    user = env.add_user("g@gmail.com", password="password1")
    identity = env.add_identity(user)
    env.login_as(user)
    res = env.client.delete(f"/hoondok/auth/identities/{identity.id}", headers=XHR)
    assert res.status_code == 204
    assert env.identities() == []
    me = env.client.get("/hoondok/auth/me").json()["user"]
    assert [m["provider"] for m in me["login_methods"]] == ["password"]
    assert env.client.post("/hoondok/auth/login", json={"email": "g@gmail.com", "password": "password1"}, headers=XHR).status_code == 200


def test_delete_identity_of_another_user_or_unknown_is_404(env: Env):
    other = env.add_user("o@gmail.com", password=None)
    theirs = env.add_identity(other, "sub-o")
    me = env.add_user("me@example.com", password="password1")
    env.add_identity(me, "sub-me")
    env.login_as(me)
    for target in (theirs.id, uuid.uuid4()):
        res = env.client.delete(f"/hoondok/auth/identities/{target}", headers=XHR)
        assert res.status_code == 404 and res.json()["error_code"] == "IDENTITY_NOT_FOUND"
    assert len(env.identities()) == 2


def test_delete_identity_requires_csrf_header_and_login(env: Env):
    user = env.add_user("g@gmail.com", password="password1")
    identity = env.add_identity(user)
    env.login_as(user)
    assert env.client.delete(f"/hoondok/auth/identities/{identity.id}").status_code == 403
    assert len(env.identities()) == 1
    env.cookies()
    assert env.client.delete(f"/hoondok/auth/identities/{identity.id}", headers=XHR).status_code == 401
    assert len(env.identities()) == 1


# =============================== 가입 종료 · 비밀번호 로그인 · me ===============================


def test_signup_is_410_and_creates_no_user_rows(env: Env):
    body = {"email": "x@example.com", "password": "password1", "display_name": "가입"}
    res = env.client.post("/hoondok/auth/signup", json=body, headers=XHR)
    assert res.status_code == 410 and res.json()["error_code"] == "PASSWORD_SIGNUP_CLOSED"
    assert env.users() == []


def test_password_login_still_works_for_existing_account(env: Env):
    env.add_user("old@example.com", password="password1")
    res = env.client.post("/hoondok/auth/login", json={"email": "old@example.com", "password": "password1"}, headers=XHR)
    assert res.status_code == 200
    me = env.client.get("/hoondok/auth/me").json()["user"]
    assert [m["provider"] for m in me["login_methods"]] == ["password"]
    assert me["login_methods"][0]["identity_id"] is None


def test_me_login_methods_reflect_password_and_google_exactly(env: Env):
    user = env.add_user("both@gmail.com", password="password1")
    identity = env.add_identity(user, email="both@gmail.com")
    env.login_as(user)
    methods = env.client.get("/hoondok/auth/me").json()["user"]["login_methods"]
    assert [m["provider"] for m in methods] == ["password", "google"]
    assert methods[0]["identity_id"] is None
    assert methods[1]["identity_id"] == str(identity.id) and methods[1]["email"] == "both@gmail.com" and methods[1]["linked_at"]


# =============================== 탈퇴 ===============================


def test_delete_account_then_same_google_signs_up_as_new_user(env: Env):
    assert outcome(env.run(claims={"email": "gone@gmail.com"})) == "created"
    (first,) = env.users()
    old_cookie = env.client.cookies.get(COOKIE_NAME)

    assert env.client.delete("/hoondok/auth/me", headers=XHR).status_code == 204
    assert env.identities() == []
    gone = env.user(first.id)
    assert gone.deleted_at is not None and gone.password_hash is None and gone.email == f"deleted:{first.id}"

    env.cookies()
    res = env.run(claims={"email": "gone@gmail.com"})
    assert outcome(res) == "created"  # signed_in 이 아니라 새 계정
    new_id = uuid.UUID(env.client.get("/hoondok/auth/me").json()["user"]["id"])
    assert new_id != first.id

    env.cookies()
    env.client.cookies.set(COOKIE_NAME, old_cookie)  # 옛 세션 쿠키
    assert env.client.get("/hoondok/auth/me").status_code == 401


# =============================== 개인정보: 로그 ===============================

_SECRET_CODE = "4/0AVeryS3cretAuthCode"
_SECRET_EMAIL = "secret.person@gmail.com"


def _assert_no_leak(caplog, *needles: str) -> None:
    """서버 쪽 로그만 본다 — 테스트 하니스(TestClient 의 httpx 요청 로그·SQLite 드라이버 로그)는 제외한다."""
    records = [
        r
        for r in caplog.records
        if not r.name.startswith(("aiosqlite", "sqlalchemy", "asyncio")) and "testserver" not in r.getMessage()
    ]
    assert records, "검사할 서버 로그가 없다"
    dump = "\n".join(f"{r.name} {r.getMessage()} {r.__dict__}" for r in records)
    for needle in needles:
        assert needle not in dump, f"로그에 민감 값이 남았다: {needle[:12]}..."


def test_failure_logs_do_not_contain_code_id_token_or_email(env: Env, caplog):
    caplog.set_level(logging.DEBUG)
    env.last_code = _SECRET_CODE
    q = env.start_ok()
    token = sign_rs256(make_claims(nonce="wrong", email=_SECRET_EMAIL))
    res = env.callback(q, id_token=token)
    assert outcome(res) == "error=failed"
    assert any(r.getMessage() == "OAuthCallbackFailed" for r in caplog.records)  # 실패가 실제로 로그에 남았음
    _assert_no_leak(caplog, _SECRET_CODE, token, _SECRET_EMAIL, q["state"], q["nonce"])


def test_token_endpoint_failure_logs_do_not_contain_code(env: Env, caplog):
    caplog.set_level(logging.DEBUG)
    env.last_code = _SECRET_CODE
    env.google.token_status = 400
    q = env.start_ok()
    assert outcome(env.callback(q, id_token="x")) == "error=failed"
    _assert_no_leak(caplog, _SECRET_CODE, "invalid_grant")


def test_rejection_and_success_logs_do_not_contain_email(env: Env, caplog):
    caplog.set_level(logging.DEBUG)
    env.add_user(_SECRET_EMAIL)
    env.last_code = _SECRET_CODE
    assert outcome(env.run(claims={"email": _SECRET_EMAIL})) == "error=email_exists"
    assert outcome(env.run(claims={"email": "other.secret@gmail.com", "sub": "s2"})) == "created"
    _assert_no_leak(caplog, _SECRET_CODE, _SECRET_EMAIL, "other.secret")


def test_access_log_filter_strips_callback_query():
    from app.core.common.middleware import HoondokAccessLogFilter

    def run(target: str) -> str:
        record = logging.LogRecord(
            "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
            ("127.0.0.1:5000", "GET", target, "1.1", 302), None,
        )
        assert HoondokAccessLogFilter().filter(record) is True
        return record.getMessage()

    line = run("/hoondok/auth/oauth/google/callback?code=4%2F0SECRET&state=STATE123&scope=email")
    assert "SECRET" not in line and "STATE123" not in line and "?" not in line
    assert "/hoondok/auth/oauth/google/callback" in line
    assert "?" not in run("/hoondok/auth/oauth/kakao/callback/?code=X&state=Y")
    assert run("/hoondok/auth/me?x=1").count("?x=1") == 1  # 다른 경로는 건드리지 않는다


def test_access_log_filter_is_installed_on_uvicorn_access_logger():
    from app.core.common.middleware import HoondokAccessLogFilter

    assert any(isinstance(f, HoondokAccessLogFilter) for f in logging.getLogger("uvicorn.access").filters)
