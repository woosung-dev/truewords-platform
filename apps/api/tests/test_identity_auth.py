"""훈독 identity — API-HD-002·003: 가입·로그인·쿠키 hoondok_token·JWT aud 분리·CSRF."""

from __future__ import annotations

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
from app.modules.admin.auth import create_access_token
from app.modules.admin.dependencies import get_current_admin
from app.modules.identity.dependencies import (
    COOKIE_NAME,
    decode_hoondok_token,
    get_current_user,
    get_identity_repository,
    get_optional_user,
)
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.schemas import LoginRequest, SignupRequest
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


def _signup(email="Hoondok@Example.com", password="password1", display_name="효진") -> SignupRequest:
    return SignupRequest(email=email, password=password, display_name=display_name)


# --- service --------------------------------------------------------------


@pytest.mark.asyncio
async def test_signup_normalizes_email_and_hashes_password(repo: UserRepository):
    service = IdentityService(repo)
    user = await service.signup(_signup())
    assert user.email == "hoondok@example.com"
    assert user.password_hash != "password1" and user.password_hash.startswith("$2b$")
    assert user.consented_at is None and user.consent_version is None
    assert user.timezone == "Asia/Seoul"


@pytest.mark.asyncio
async def test_signup_duplicate_email_is_409_case_insensitive(repo: UserRepository):
    service = IdentityService(repo)
    await service.signup(_signup())
    with pytest.raises(HTTPException) as exc:
        await service.signup(_signup(email="HOONDOK@example.com"))
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_login_wrong_password_unknown_email_and_deleted_share_401(repo: UserRepository):
    service = IdentityService(repo)
    user = await service.signup(_signup())
    assert (await service.login(LoginRequest(email="hoondok@example.com", password="password1"))).id == user.id

    for req in (
        LoginRequest(email="hoondok@example.com", password="wrong-pass"),
        LoginRequest(email="nobody@example.com", password="password1"),
    ):
        with pytest.raises(HTTPException) as exc:
            await service.login(req)
        assert exc.value.status_code == 401
        assert exc.value.detail == "이메일 또는 비밀번호가 올바르지 않습니다"

    user.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await repo.session.commit()
    with pytest.raises(HTTPException) as exc:
        await service.login(LoginRequest(email="hoondok@example.com", password="password1"))
    assert exc.value.status_code == 401


# --- 토큰 aud 분리 -----------------------------------------------------------


def test_hoondok_token_round_trips_with_aud():
    user = User(email="a@b.c", password_hash="x", display_name="n")
    token = IdentityService.issue_token(user)
    assert decode_hoondok_token(token) == user.id


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

    user.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    assert await get_optional_user(req, repo) is None
    with pytest.raises(HTTPException) as exc:
        await get_current_user(None)
    assert exc.value.status_code == 401


# --- 라우터 쿠키 흐름 ---------------------------------------------------------


@pytest.fixture
def client():
    repo = _MemoryRepo()
    app.dependency_overrides[get_identity_repository] = lambda: repo
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_identity_repository, None)


def test_signup_me_logout_cookie_flow(client: TestClient):
    body = {"email": "New@Example.com", "password": "password1", "display_name": "새벽"}
    created = client.post("/hoondok/auth/signup", json=body, headers=XHR)
    assert created.status_code == 201, created.text
    assert created.json()["user"]["email"] == "new@example.com"
    assert set(created.json()["user"]) == {"id", "email", "display_name"}
    cookie = created.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE_NAME}=") and "HttpOnly" in cookie and "Path=/" in cookie
    assert "admin_token" not in cookie

    me = client.get("/hoondok/auth/me")
    assert me.status_code == 200 and me.json()["user"]["display_name"] == "새벽"

    assert client.post("/hoondok/auth/signup", json=body, headers=XHR).status_code == 409

    out = client.post("/hoondok/auth/logout", headers=XHR)
    assert out.status_code == 204
    assert client.get("/hoondok/auth/me").status_code == 401

    login = client.post("/hoondok/auth/login", json={"email": "new@example.com", "password": "password1"}, headers=XHR)
    assert login.status_code == 200 and login.json()["user"]["email"] == "new@example.com"
    assert client.get("/hoondok/auth/me").status_code == 200

    bad = client.post("/hoondok/auth/login", json={"email": "new@example.com", "password": "nope-nope"}, headers=XHR)
    assert bad.status_code == 401


def test_me_with_admin_token_only_is_401(client: TestClient):
    admin = create_access_token({"sub": str(uuid.uuid4()), "role": "admin", "email": "admin@test.com"})
    client.cookies.set("admin_token", admin)
    assert client.get("/hoondok/auth/me").status_code == 401
    client.cookies.set(COOKIE_NAME, admin)
    assert client.get("/hoondok/auth/me").status_code == 401


def test_mutations_require_xhr_header_and_validate_body(client: TestClient):
    body = {"email": "x@example.com", "password": "password1", "display_name": "x"}
    assert client.post("/hoondok/auth/signup", json=body).status_code == 403
    assert client.post("/hoondok/auth/logout").status_code == 403
    assert client.post("/hoondok/auth/signup", json={**body, "password": "short"}, headers=XHR).status_code == 422
    assert client.post("/hoondok/auth/signup", json={**body, "email": "not-an-email"}, headers=XHR).status_code == 422


# --- Phase 3 F: 제한 베타 초대 코드 게이트 (HOONDOK_INVITE_CODE) ---


def test_signup_invite_gate_when_configured(client: TestClient, monkeypatch):
    """설정 시: 누락·불일치 403 INVITE_REQUIRED(ErrorResponse 형식), 일치 201 + 쿠키. 게이트는 중복 409 보다 먼저.
    로그인·로그아웃은 코드와 무관하다. 앞뒤 공백은 양쪽 모두 무시하고, 한글 코드도 비교한다."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "hoondok_invite_code", SecretStr(" 새벽-2026 "))
    body = {"email": "Gate@Example.com", "password": "password1", "display_name": "게이트"}

    missing = client.post("/hoondok/auth/signup", json=body, headers=XHR)
    assert missing.status_code == 403, missing.text
    assert missing.json()["error_code"] == "INVITE_REQUIRED"
    assert "초대 코드" in missing.json()["message"]
    assert "request_id" in missing.json()
    assert "set-cookie" not in missing.headers

    wrong = client.post("/hoondok/auth/signup", json={**body, "invite_code": "틀린코드"}, headers=XHR)
    assert wrong.status_code == 403 and wrong.json()["error_code"] == "INVITE_REQUIRED"
    assert client.post("/hoondok/auth/signup", json={**body, "invite_code": "   "}, headers=XHR).status_code == 403

    ok = client.post("/hoondok/auth/signup", json={**body, "invite_code": " 새벽-2026"}, headers=XHR)
    assert ok.status_code == 201, ok.text
    assert ok.headers["set-cookie"].startswith(f"{COOKIE_NAME}=")

    # 기존 이메일 + 틀린 코드 → 403 (409 가 아니어야 이메일 존재 여부가 새지 않는다), 맞는 코드 → 409
    assert client.post("/hoondok/auth/signup", json={**body, "invite_code": "x"}, headers=XHR).status_code == 403
    assert client.post("/hoondok/auth/signup", json={**body, "invite_code": "새벽-2026"}, headers=XHR).status_code == 409

    assert client.post("/hoondok/auth/logout", headers=XHR).status_code == 204
    login = client.post(
        "/hoondok/auth/login", json={"email": "gate@example.com", "password": "password1"}, headers=XHR
    )
    assert login.status_code == 200 and client.get("/hoondok/auth/me").status_code == 200


@pytest.mark.parametrize("configured", [None, SecretStr(""), SecretStr("   ")], ids=["unset", "empty", "blank"])
def test_signup_ignores_invite_code_when_gate_off(client: TestClient, monkeypatch, configured):
    """미설정·빈 값(`HOONDOK_INVITE_CODE=` 는 SecretStr("") 로 들어온다)이면 invite_code 는 무시된다 — 로컬·E2E 기존 동작.
    필드 자체는 스키마에 있으므로 64자 초과만 422."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "hoondok_invite_code", configured)
    body = {"email": "open@example.com", "password": "password1", "display_name": "열림"}
    assert client.post("/hoondok/auth/signup", json={**body, "invite_code": "아무거나"}, headers=XHR).status_code == 201
    assert client.post("/hoondok/auth/signup", json={**body, "email": "open2@example.com"}, headers=XHR).status_code == 201
    too_long = client.post(
        "/hoondok/auth/signup", json={**body, "email": "open3@example.com", "invite_code": "x" * 65}, headers=XHR
    )
    assert too_long.status_code == 422
