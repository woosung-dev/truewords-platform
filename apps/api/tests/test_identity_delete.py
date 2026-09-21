"""훈독 API-HD-011 계정 삭제 — deleted_at 소프트 삭제 + 이메일 익명화 + 훈독 기록 하드 삭제 · 204 + 쿠키 삭제 · 403/401 · 재가입 201."""

from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.main import app
from app.modules.admin.auth import create_access_token
from app.modules.hoondok.dependencies import get_jeongseong_repository, get_mission_repository
from app.modules.hoondok.models import ClientErrorEvent, JeongseongPeriod, JeongseongReading, MissionLog
from app.modules.hoondok.repository import JeongseongRepository, MissionLogRepository
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.schemas import LoginRequest, SignupRequest
from app.modules.identity.service import IdentityService

TODAY = date(2026, 9, 19)
XHR = {"X-Requested-With": "XMLHttpRequest"}
ME = "/hoondok/auth/me"


def _signup(email: str, password: str = "password1", display_name: str = "효진") -> SignupRequest:
    return SignupRequest(email=email, password=password, display_name=display_name)


# --- service (aiosqlite, 실제 리포) -----------------------------------------------


@pytest.fixture
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[User.__table__, MissionLog.__table__, JeongseongPeriod.__table__, JeongseongReading.__table__, ClientErrorEvent.__table__],
        )
    session = AsyncSession(engine, expire_on_commit=False)
    try:
        yield session
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_delete_account_sets_deleted_at_anonymizes_email_and_blocks_login(session: AsyncSession):
    users = UserRepository(session)
    service = IdentityService(users)
    user = await service.signup(_signup("Del@Example.com"))

    await service.delete_account(user, purgers=[])

    fetched = await users.get_by_id(user.id)
    assert fetched is not None and fetched.deleted_at is not None
    assert fetched.email == f"deleted:{user.id}"
    assert await users.get_by_email("del@example.com") is None
    with pytest.raises(HTTPException) as exc:
        await service.login(LoginRequest(email="del@example.com", password="password1"))
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_delete_account_purges_hoondok_rows_in_same_commit(session: AsyncSession):
    """실 리포로 하드 삭제 + 다른 사용자 데이터 보존. purger 는 커밋하지 않고 users.save 커밋에 묶인다."""
    users, missions, periods = UserRepository(session), MissionLogRepository(session), JeongseongRepository(session)
    service = IdentityService(users)
    me = await service.signup(_signup("me@example.com"))
    other = await service.signup(_signup("other@example.com"))
    for u in (me, other):
        await missions.create(MissionLog(user_id=u.id, mission_date=TODAY, kind="read"))
        period = await periods.create(JeongseongPeriod(user_id=u.id, topic="감사", duration_days=7, started_on=TODAY))
        session.add(JeongseongReading(period_id=period.id, reading_date=TODAY, volume="v", chunk_id="1", body="말씀", title="제목", work_title="저작물"))
        session.add(ClientErrorEvent(user_id=u.id, kind="api_5xx", message="API 서비스 오류", path="/hoondok/search"))
        await session.commit()

    await service.delete_account(me, purgers=[missions, periods])

    assert await missions.list_dates(me.id, "read") == [] and await periods.get_active(me.id) is None
    assert await missions.list_dates(other.id, "read") == [TODAY] and await periods.get_active(other.id) is not None
    assert (await users.get_by_id(me.id)).deleted_at is not None
    assert (await users.get_by_id(other.id)).deleted_at is None
    assert len((await session.execute(select(JeongseongReading))).scalars().all()) == 1
    errors = (await session.execute(select(ClientErrorEvent))).scalars().all()
    assert len(errors) == 1 and errors[0].user_id == other.id
    # 같은 이메일로 재가입 — unique 인덱스 충돌 없음
    again = await service.signup(_signup("me@example.com", password="password2"))
    assert again.id != me.id and again.email == "me@example.com"


@pytest.mark.asyncio
async def test_delete_account_partial_failure_leaves_nothing_deleted(session: AsyncSession):
    """purger 중간 실패 — 예외가 전파되고 users.save 커밋에 닿지 못하므로 앞선 DELETE 도 남지 않는다."""

    class _FailingPurger:
        async def delete_for_user(self, user_id: uuid.UUID) -> None:
            raise RuntimeError("purge 실패")

    users, missions, periods = UserRepository(session), MissionLogRepository(session), JeongseongRepository(session)
    service = IdentityService(users)
    me = await service.signup(_signup("boom@example.com"))
    await missions.create(MissionLog(user_id=me.id, mission_date=TODAY, kind="read"))
    await periods.create(JeongseongPeriod(user_id=me.id, topic="감사", duration_days=7, started_on=TODAY))

    with pytest.raises(RuntimeError):
        await service.delete_account(me, purgers=[missions, _FailingPurger(), periods])

    # 커밋 없이 끝난 트랜잭션은 close 에서 롤백된다 — 같은 연결(StaticPool)로 다시 읽어 실제 DB 상태를 본다
    await session.close()
    refetched = await users.get_by_id(me.id)
    assert refetched is not None and refetched.deleted_at is None and refetched.email == "boom@example.com"
    assert await missions.list_dates(me.id, "read") == [TODAY]
    assert await periods.get_active(me.id) is not None  # 실패 뒤 purger 는 아예 실행되지 않았다


# --- router (인메모리 fake) -------------------------------------------------------


class _MemoryUsers:
    def __init__(self) -> None:
        self.users: dict[uuid.UUID, User] = {}
        self.session = MagicMock()

    async def get_by_email(self, email: str) -> User | None:
        email = email.strip().lower()
        return next((u for u in self.users.values() if u.email == email), None)

    async def get_for_update(self, user_id: uuid.UUID):
        return await self.get_by_id(user_id)

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return self.users.get(user_id)

    async def create(self, user: User) -> User:
        user.email = user.email.strip().lower()
        self.users[user.id] = user
        return user

    async def save(self, user: User) -> User:
        self.users[user.id] = user
        return user


class _FakeLogs:
    def __init__(self) -> None:
        self.rows: set[tuple] = set()
        self.session = MagicMock()

    async def create(self, log: MissionLog) -> MissionLog:
        key = (log.user_id, log.mission_date, log.kind)
        if key in self.rows:
            raise IntegrityError("dup", None, Exception("uq"))
        self.rows.add(key)
        return log

    async def list_dates(self, user_id, kind):
        return sorted(d for u, d, k in self.rows if u == user_id and k == kind)

    async def delete_for_user(self, user_id) -> None:
        self.rows = {r for r in self.rows if r[0] != user_id}


class _FakePeriods:
    def __init__(self) -> None:
        self.rows: dict[uuid.UUID, JeongseongPeriod] = {}
        self.session = MagicMock()

    async def get_active(self, user_id):
        return next((p for p in self.rows.values() if p.user_id == user_id and p.status == "active"), None)

    async def create(self, period: JeongseongPeriod) -> JeongseongPeriod:
        self.rows[period.id] = period
        return period

    async def save(self, period: JeongseongPeriod) -> JeongseongPeriod:
        self.rows[period.id] = period
        return period

    async def delete_for_user(self, user_id) -> None:
        self.rows = {k: p for k, p in self.rows.items() if p.user_id != user_id}


@pytest.fixture
def client():
    users, logs, periods = _MemoryUsers(), _FakeLogs(), _FakePeriods()
    app.dependency_overrides[get_identity_repository] = lambda: users
    app.dependency_overrides[get_mission_repository] = lambda: logs
    app.dependency_overrides[get_jeongseong_repository] = lambda: periods
    try:
        c = TestClient(app)
        c.users, c.logs, c.periods = users, logs, periods  # type: ignore[attr-defined]
        yield c
    finally:
        for dep in (get_identity_repository, get_mission_repository, get_jeongseong_repository):
            app.dependency_overrides.pop(dep, None)


def _join(client: TestClient, email: str = "new@example.com") -> dict:
    created = client.post(
        "/hoondok/auth/signup", json={"email": email, "password": "password1", "display_name": "새벽"}, headers=XHR
    )
    assert created.status_code == 201, created.text
    return created.json()["user"]


def test_delete_me_204_clears_cookie_then_me_401(client: TestClient):
    user = _join(client)
    assert client.get(ME).status_code == 200

    deleted = client.delete(ME, headers=XHR)
    assert deleted.status_code == 204, deleted.text
    cookie = deleted.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE_NAME}=") and "Max-Age=0" in cookie
    # 발급 때와 같은 Path·HttpOnly 여야 브라우저가 같은 쿠키로 인식해 실제로 지운다
    assert "Path=/" in cookie and "HttpOnly" in cookie
    assert client.get(ME).status_code == 401

    # 삭제 전 발급된 토큰을 다시 넣어도 deleted_at 으로 거른다 — 소프트 삭제가 세션 차단을 겸한다
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(client.users.users[uuid.UUID(user["id"])]))
    assert client.get(ME).status_code == 401
    login = client.post(
        "/hoondok/auth/login", json={"email": "new@example.com", "password": "password1"}, headers=XHR
    )
    assert login.status_code == 401


def test_delete_me_requires_xhr_header_and_cookie(client: TestClient):
    assert client.delete(ME, headers=XHR).status_code == 401  # 쿠키 없음
    admin = create_access_token({"sub": str(uuid.uuid4()), "role": "admin", "email": "admin@test.com"})
    client.cookies.set("admin_token", admin)
    assert client.delete(ME, headers=XHR).status_code == 401  # admin_token 만

    client.cookies.clear()
    _join(client)
    assert client.delete(ME).status_code == 403  # CSRF 헤더 없음
    assert client.get(ME).status_code == 200  # 계정은 그대로
    assert client.delete(ME, headers=XHR).status_code == 204


def test_delete_me_removes_mission_logs_and_jeongseong(client: TestClient):
    me = _join(client, "me@example.com")
    me_id = uuid.UUID(me["id"])
    assert client.post("/hoondok/missions/read/complete", headers=XHR).status_code == 201
    assert client.post("/hoondok/missions/pray/complete", headers=XHR).status_code == 201
    assert client.post("/hoondok/me/jeongseong", json={"topic": "감사", "duration_days": 7}, headers=XHR).status_code == 201
    # 다른 사용자 데이터는 남아야 한다
    other_id = uuid.uuid4()
    client.logs.rows.add((other_id, TODAY, "read"))
    client.periods.rows[uuid.uuid4()] = JeongseongPeriod(user_id=other_id, topic="다른", duration_days=7, started_on=TODAY)
    assert len(client.logs.rows) == 3 and len(client.periods.rows) == 2

    assert client.delete(ME, headers=XHR).status_code == 204

    assert client.logs.rows == {(other_id, TODAY, "read")}
    assert [p.user_id for p in client.periods.rows.values()] == [other_id]
    stored = client.users.users[me_id]
    assert stored.deleted_at is not None and stored.email == f"deleted:{me_id}"


def test_signup_same_email_after_delete_is_201(client: TestClient):
    first = _join(client, "Again@Example.com")
    assert client.delete(ME, headers=XHR).status_code == 204

    second = _join(client, "again@example.com")
    assert second["id"] != first["id"] and second["email"] == "again@example.com"
    assert client.get(ME).json()["user"]["id"] == second["id"]
    # 삭제된 계정은 익명화된 이메일로 남고, 새 계정만 그 주소를 쓴다
    emails = sorted(u.email for u in client.users.users.values())
    assert emails == sorted([f"deleted:{first['id']}", "again@example.com"])
