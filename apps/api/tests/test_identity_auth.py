"""훈독 identity — API-HD-002·003: 가입 종료(410)·로그인·쿠키 hoondok_token·JWT aud 분리·CSRF."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from pydantic import SecretStr
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from unittest.mock import MagicMock

from app.main import app
from app.modules.admin.auth import create_access_token, hash_password
from app.modules.admin.dependencies import get_current_admin
from app.modules.identity.dependencies import (
    COOKIE_NAME,
    decode_hoondok_session,
    decode_hoondok_token,
    get_current_user,
    get_identity_repository,
    get_optional_user,
    get_user_identity_repository,
)
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.schemas import LoginRequest
from app.modules.identity.service import AUDIENCE, IdentityService

XHR = {"X-Requested-With": "XMLHttpRequest"}


@pytest.fixture
async def repo():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[User.__table__])
    session = AsyncSession(engine, expire_on_commit=False)
    try:
        yield UserRepository(session)
    finally:
        await session.close()
        await engine.dispose()


def _user(email="Hoondok@Example.com", password: str | None = "password1", display_name="효진") -> User:
    """가입 API 는 닫혔다 — 계정은 저장소에 직접 만든다. password=None 은 소셜 전용 계정."""
    return User(email=email, password_hash=hash_password(password) if password else None, display_name=display_name)


# --- service --------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_normalizes_email_and_keeps_defaults(repo: UserRepository):
    user = await repo.create(_user())
    assert user.email == "hoondok@example.com"
    assert user.password_hash != "password1" and user.password_hash.startswith("$2b$")
    assert user.consented_at is None and user.consent_version is None
    assert user.timezone == "Asia/Seoul"
    assert user.email_verified_at is None and user.email_verified_by is None


@pytest.mark.asyncio
async def test_login_for_account_without_password_is_401_and_still_runs_bcrypt(repo: UserRepository):
    """소셜 전용 계정(password_hash NULL)도 500 이 아니라 같은 401 이고, 타이밍 보호(bcrypt 1회)도 유지된다."""
    from unittest.mock import patch

    from app.modules.admin import auth as auth_module

    await repo.create(_user(password=None))
    with patch.object(auth_module, "verify_password", wraps=auth_module.verify_password) as spy:
        with pytest.raises(HTTPException) as exc:
            await IdentityService(repo).login(LoginRequest(email="hoondok@example.com", password="password1"))
    assert exc.value.status_code == 401
    assert exc.value.detail == "이메일 또는 비밀번호가 올바르지 않습니다"
    assert spy.call_count == 1


@pytest.mark.asyncio
async def test_login_wrong_password_unknown_email_and_deleted_share_401(repo: UserRepository):
    service = IdentityService(repo)
    user = await repo.create(_user())
    assert (await service.login(LoginRequest(email="hoondok@example.com", password="password1"))).id == user.id

    for req in (
        LoginRequest(email="hoondok@example.com", password="wrong-pass"),
        LoginRequest(email="nobody@example.com", password="password1"),
    ):
        with pytest.raises(HTTPException) as exc:
            await service.login(req)
        assert exc.value.status_code == 401
        assert exc.value.detail == "이메일 또는 비밀번호가 올바르지 않습니다"

    user.deleted_at = datetime.now(timezone.utc)
    await repo.session.commit()
    with pytest.raises(HTTPException) as exc:
        await service.login(LoginRequest(email="hoondok@example.com", password="password1"))
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_email_still_runs_bcrypt(repo: UserRepository):
    """보안 점검 login-bcrypt-short-circuit-timing-enumeration 회귀 —
    없는 이메일도 bcrypt 비교를 한 번 돌려 응답 시간으로 가입 여부가 드러나지 않는다(API-HD-003)."""
    from unittest.mock import patch

    from app.modules.admin import auth as auth_module

    service = IdentityService(repo)
    with patch.object(auth_module, "verify_password", wraps=auth_module.verify_password) as spy:
        with pytest.raises(HTTPException):
            await service.login(LoginRequest(email="nobody@example.com", password="password1"))
    assert spy.call_count == 1


# --- 토큰 aud 분리 -----------------------------------------------------------


def test_hoondok_token_round_trips_with_aud():
    user = User(email="a@b.c", password_hash="x", display_name="n")
    token = IdentityService.issue_token(user)
    assert decode_hoondok_token(token) == user.id


def test_issue_token_carries_session_version_and_decoder_reads_it():
    user = User(email="a@b.c", password_hash="x", display_name="n", session_version=3)
    assert decode_hoondok_session(IdentityService.issue_token(user)) == (user.id, 3)
    assert decode_hoondok_session(IdentityService.issue_token(User(email="a@b.c", display_name="n")))[1] == 0


def test_token_without_sv_is_read_as_version_zero():
    """배포 전에 발급된 토큰 호환."""
    uid = uuid.uuid4()
    assert decode_hoondok_session(create_access_token({"sub": str(uid), "aud": AUDIENCE})) == (uid, 0)


@pytest.mark.parametrize("bad", ["1", 1.5, None, True, [1]])
def test_token_with_non_integer_sv_is_rejected(bad):
    token = create_access_token({"sub": str(uuid.uuid4()), "aud": AUDIENCE, "sv": bad})
    assert decode_hoondok_session(token) is None


def test_admin_style_token_without_aud_is_rejected_by_hoondok_decoder():
    """python-jose 는 aud 없는 토큰을 audience 검사에서 통과시킨다 — 명시 검사 회귀."""
    token = create_access_token({"sub": str(uuid.uuid4()), "role": "admin", "email": "admin@test.com"})
    assert decode_hoondok_token(token) is None


def test_wrong_audience_and_garbage_are_rejected():
    token = create_access_token({"sub": str(uuid.uuid4()), "aud": "other"})
    assert decode_hoondok_token(token) is None
    assert decode_hoondok_token("not.a.jwt") is None


@pytest.mark.asyncio
async def test_hoondok_token_cannot_authenticate_admin():
    token = IdentityService.issue_token(User(email="a@b.c", password_hash="x", display_name="n"))
    request = MagicMock()
    request.cookies = {"admin_token": token}
    with pytest.raises(HTTPException) as exc:
        await get_current_admin(request)
    assert exc.value.status_code == 401


# --- 의존성 ---------------------------------------------------------------


class _MemoryRepo:
    """라우터 테스트용 인메모리 저장소 (TestClient 이벤트 루프와 aiosqlite 커넥션 분리)."""

    def __init__(self) -> None:
        self.users: dict[uuid.UUID, User] = {}
        self.session = MagicMock()

    async def get_by_email(self, email: str) -> User | None:
        email = email.strip().lower()
        return next((u for u in self.users.values() if u.email == email), None)

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return self.users.get(user_id)

    async def create(self, user: User) -> User:
        user.email = user.email.strip().lower()
        self.users[user.id] = user
        return user


@pytest.mark.asyncio
async def test_get_optional_user_ignores_admin_token_and_deleted_users():
    repo = _MemoryRepo()
    user = await repo.create(User(email="a@b.c", password_hash="x", display_name="n"))
    hoondok = IdentityService.issue_token(user)
    admin = create_access_token({"sub": str(user.id), "role": "admin"})

    req = MagicMock()
    req.cookies = {"admin_token": admin}
    assert await get_optional_user(req, repo) is None
    req.cookies = {COOKIE_NAME: admin}
    assert await get_optional_user(req, repo) is None
    req.cookies = {COOKIE_NAME: hoondok}
    assert (await get_optional_user(req, repo)) is user

    user.deleted_at = datetime.now(timezone.utc)
    assert await get_optional_user(req, repo) is None
    with pytest.raises(HTTPException) as exc:
        await get_current_user(None)
    assert exc.value.status_code == 401


# --- 라우터 쿠키 흐름 ---------------------------------------------------------


class _MemoryIdentities:
    """로그인 수단 fake — 이 파일은 로그인 수단이 없는(비밀번호만 있는) 계정만 본다."""

    session = MagicMock()

    async def list_for_user(self, user_id: uuid.UUID) -> list:
        return []


@pytest.fixture
def client():
    repo = _MemoryRepo()
    app.dependency_overrides[get_identity_repository] = lambda: repo
    app.dependency_overrides[get_user_identity_repository] = lambda: _MemoryIdentities()
    try:
        c = TestClient(app)
        c.repo = repo  # type: ignore[attr-defined]
        yield c
    finally:
        app.dependency_overrides.pop(get_identity_repository, None)
        app.dependency_overrides.pop(get_user_identity_repository, None)


def test_login_me_logout_cookie_flow(client: TestClient):
    asyncio.run(client.repo.create(_user("New@Example.com", display_name="새벽")))  # type: ignore[attr-defined]
    login = client.post("/hoondok/auth/login", json={"email": "new@example.com", "password": "password1"}, headers=XHR)
    assert login.status_code == 200, login.text
    user = login.json()["user"]
    assert user["email"] == "new@example.com"
    assert set(user) == {"id", "email", "display_name", "login_methods"}
    # 비밀번호는 provider="password" 로 드러난다 — 소셜 수단이 없으니 연결 안내 대상이다
    assert user["login_methods"] == [{"provider": "password", "identity_id": None, "email": "new@example.com", "linked_at": None}]
    cookie = login.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE_NAME}=") and "HttpOnly" in cookie and "Path=/" in cookie
    assert "admin_token" not in cookie

    me = client.get("/hoondok/auth/me")
    assert me.status_code == 200 and me.json()["user"]["display_name"] == "새벽"
    assert me.json()["user"]["login_methods"] == user["login_methods"]

    out = client.post("/hoondok/auth/logout", headers=XHR)
    assert out.status_code == 204
    assert client.get("/hoondok/auth/me").status_code == 401

    bad = client.post("/hoondok/auth/login", json={"email": "new@example.com", "password": "nope-nope"}, headers=XHR)
    assert bad.status_code == 401


def test_login_for_account_without_password_is_401(client: TestClient):
    asyncio.run(client.repo.create(_user("social@example.com", password=None)))  # type: ignore[attr-defined]
    res = client.post("/hoondok/auth/login", json={"email": "social@example.com", "password": "password1"}, headers=XHR)
    assert res.status_code == 401
    assert "set-cookie" not in res.headers


@pytest.mark.parametrize("path", ["/hoondok/auth/login", "/admin/auth/login"])
def test_login_attempts_are_rate_limited_per_ip(client: TestClient, path: str):
    """보안 점검 login-bcrypt-event-loop-no-throttle 회귀 — 로그인은 IP 당 30회/분을 넘으면 bcrypt 전에 429."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from app.modules.admin import auth as auth_module
    from app.modules.admin.dependencies import get_admin_service
    from app.modules.admin.service import AdminService

    admin_repo = MagicMock()
    admin_repo.get_user_by_email = AsyncMock(return_value=None)
    app.dependency_overrides[get_admin_service] = lambda: AdminService(admin_repo)
    body = {"email": "nobody@example.com", "password": "password1"}
    try:
        with patch.object(auth_module, "verify_password", return_value=False):
            statuses = [client.post(path, json=body, headers=XHR).status_code for _ in range(30)]
            assert set(statuses) == {401}
            over = client.post(path, json=body, headers=XHR)
    finally:
        app.dependency_overrides.pop(get_admin_service, None)
    assert over.status_code == 429


def test_me_with_admin_token_only_is_401(client: TestClient):
    admin = create_access_token({"sub": str(uuid.uuid4()), "role": "admin", "email": "admin@test.com"})
    client.cookies.set("admin_token", admin)
    assert client.get("/hoondok/auth/me").status_code == 401
    client.cookies.set(COOKIE_NAME, admin)
    assert client.get("/hoondok/auth/me").status_code == 401


def test_mutations_require_xhr_header_and_validate_body(client: TestClient):
    assert client.post("/hoondok/auth/logout").status_code == 403
    assert client.post("/hoondok/auth/login", json={"email": "x@example.com", "password": "password1"}).status_code == 403
    bad_email = client.post("/hoondok/auth/login", json={"email": "not-an-email", "password": "password1"}, headers=XHR)
    assert bad_email.status_code == 422


@pytest.mark.parametrize("gate", [None, SecretStr(" 새벽-2026 ")], ids=["gate-off", "gate-on"])
def test_signup_is_closed_with_410(client: TestClient, monkeypatch, gate):
    """이메일·비밀번호 가입은 닫혔다 — 초대 코드·CSRF 헤더·중복 여부와 무관하게 410 PASSWORD_SIGNUP_CLOSED. 계정을 만들지 않는다."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "hoondok_invite_code", gate)
    body = {"email": "Closed@Example.com", "password": "password1", "display_name": "닫힘", "invite_code": "새벽-2026"}
    for headers in (XHR, {}):
        res = client.post("/hoondok/auth/signup", json=body, headers=headers)
        assert res.status_code == 410, res.text
        assert res.json()["error_code"] == "PASSWORD_SIGNUP_CLOSED"
        assert "set-cookie" not in res.headers
    assert client.repo.users == {}  # type: ignore[attr-defined]
    # 요청 스키마는 유지된다 — 형식이 틀리면 410 이전에 422
    assert client.post("/hoondok/auth/signup", json={**body, "password": "short"}, headers=XHR).status_code == 422
