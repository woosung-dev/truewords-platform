"""훈독 알림 API-HD-019~022 — VAPID 게이트 · 설정 upsert · 구독 endpoint upsert/소유 이전 · 해지 멱등 · CSRF/401."""

from __future__ import annotations

import uuid
from datetime import time

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.core.config import settings
from app.main import app
from app.modules.hoondok.dependencies import get_notification_repository
from app.modules.hoondok.models import NotificationPreference, PushSubscription
from app.modules.hoondok.notifications_repository import NotificationRepository
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.service import IdentityService

XHR = {"X-Requested-With": "XMLHttpRequest"}
ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123"
CONFIG = "/hoondok/push/config"
PREFS = "/hoondok/me/notifications"
PUSH = "/hoondok/me/push"


def _subscription(endpoint: str = ENDPOINT, **keys: str) -> dict:
    return {
        "endpoint": endpoint,
        "keys": {"p256dh": keys.get("p256dh", "BPk1"), "auth": keys.get("auth", "auth1")},
        "user_agent": keys.get("user_agent"),
    }


@pytest.fixture
def push_on(monkeypatch):
    """conftest 의 기본 OFF 를 덮어 VAPID 3값을 채운다."""
    monkeypatch.setattr(settings, "hoondok_vapid_public_key", "BTestPublicKey")
    monkeypatch.setattr(settings, "hoondok_vapid_private_key", SecretStr("test-private"))
    monkeypatch.setattr(settings, "hoondok_vapid_subject", "mailto:admin@example.com")


# --- repository (aiosqlite) ---------------------------------------------------


@pytest.fixture
async def repo():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[User.__table__, NotificationPreference.__table__, PushSubscription.__table__],
        )
    session = AsyncSession(engine, expire_on_commit=False)
    try:
        yield NotificationRepository(session)
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_repo_endpoint_is_unique_across_users(repo: NotificationRepository):
    await repo.save_subscription(
        PushSubscription(user_id=uuid.uuid4(), endpoint=ENDPOINT, p256dh="a", auth="b")
    )
    with pytest.raises(IntegrityError):
        await repo.save_subscription(
            PushSubscription(user_id=uuid.uuid4(), endpoint=ENDPOINT, p256dh="c", auth="d")
        )
    # 롤백된 세션은 재사용 가능해야 한다 — 다른 endpoint 는 그대로 저장된다.
    other = await repo.save_subscription(
        PushSubscription(user_id=uuid.uuid4(), endpoint=ENDPOINT + "-2", p256dh="c", auth="d")
    )
    assert (await repo.get_by_endpoint(ENDPOINT + "-2")).id == other.id


@pytest.mark.asyncio
async def test_repo_delete_for_user_clears_both_tables(repo: NotificationRepository):
    mine, other = uuid.uuid4(), uuid.uuid4()
    for user_id, endpoint in ((mine, ENDPOINT), (other, ENDPOINT + "-2")):
        await repo.save_subscription(
            PushSubscription(user_id=user_id, endpoint=endpoint, p256dh="a", auth="b")
        )
        await repo.save_preference(NotificationPreference(user_id=user_id, read_enabled=True))

    await repo.delete_for_user(mine)
    await repo.session.commit()

    assert await repo.count_subscriptions(mine) == 0 and await repo.get_preference(mine) is None
    assert await repo.count_subscriptions(other) == 1 and await repo.get_preference(other) is not None


# --- router -------------------------------------------------------------------


@pytest.fixture
async def client():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[User.__table__, NotificationPreference.__table__, PushSubscription.__table__],
        )
    session = AsyncSession(engine, expire_on_commit=False)
    me = User(email="me@example.com", password_hash="x", display_name="효진")
    other = User(email="other@example.com", password_hash="x", display_name="지훈")
    session.add_all([me, other])
    await session.commit()

    class _Users:
        async def get_by_id(self, user_id):
            return await session.get(User, user_id)

    app.dependency_overrides[get_identity_repository] = lambda: _Users()
    app.dependency_overrides[get_notification_repository] = lambda: NotificationRepository(session)
    try:
        c = TestClient(app)
        c.me, c.other, c.session = me, other, session  # type: ignore[attr-defined]
        yield c
    finally:
        app.dependency_overrides.pop(get_identity_repository, None)
        app.dependency_overrides.pop(get_notification_repository, None)
        await session.close()
        await engine.dispose()


def _login(client: TestClient, user: User) -> None:
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(user))


def test_push_config_reports_disabled_without_vapid(client: TestClient):
    assert client.get(CONFIG).json() == {"enabled": False, "public_key": None}


def test_push_config_exposes_only_public_key(client: TestClient, push_on):
    assert client.get(CONFIG).json() == {"enabled": True, "public_key": "BTestPublicKey"}


def test_subscribe_rejected_with_409_when_push_disabled(client: TestClient):
    _login(client, client.me)  # type: ignore[attr-defined]
    res = client.post(PUSH, json=_subscription(), headers=XHR)
    assert res.status_code == 409
    assert res.json()["error_code"] == "PUSH_DISABLED"


def test_endpoints_require_login(client: TestClient, push_on):
    assert client.get(PREFS).status_code == 401
    assert client.put(PREFS, json={"read_enabled": True}, headers=XHR).status_code == 401
    assert client.post(PUSH, json=_subscription(), headers=XHR).status_code == 401
    assert client.delete(f"{PUSH}?endpoint={ENDPOINT}", headers=XHR).status_code == 401


def test_state_changing_endpoints_require_csrf_header(client: TestClient, push_on):
    _login(client, client.me)  # type: ignore[attr-defined]
    assert client.put(PREFS, json={"read_enabled": True}).status_code == 403
    assert client.post(PUSH, json=_subscription()).status_code == 403
    assert client.delete(f"{PUSH}?endpoint={ENDPOINT}").status_code == 403


def test_csrf_dependency_is_declared_on_every_mutating_route():
    """경로 의존성 누락을 라우트 정의 수준에서 잠근다 (tests/test_admin_user_status.py 선례)."""
    from app.modules.identity.dependencies import verify_csrf
    from route_helpers import dependency_callables, iter_api_routes

    mutating = {
        ("PUT", "/hoondok/me/notifications"),
        ("POST", "/hoondok/me/push"),
        ("DELETE", "/hoondok/me/push"),
    }
    found = set()
    for route, inherited in iter_api_routes(app):
        for method in getattr(route, "methods", None) or set():
            key = (method, getattr(route, "path", None))
            if key in mutating:
                assert verify_csrf in dependency_callables(route, inherited), f"{key} 에 verify_csrf 누락"
                found.add(key)
    assert found == mutating


def test_preferences_default_then_replace(client: TestClient):
    _login(client, client.me)  # type: ignore[attr-defined]
    assert client.get(PREFS).json() == {
        "read_enabled": False,
        "read_time": "06:00",
        "lock_screen_level": "neutral",
        "subscription_count": 0,
    }
    saved = client.put(
        PREFS,
        json={"read_enabled": True, "read_time": "21:30", "lock_screen_level": "faith"},
        headers=XHR,
    )
    assert saved.status_code == 200, saved.text
    expected = {
        "read_enabled": True,
        "read_time": "21:30",
        "lock_screen_level": "faith",
        "subscription_count": 0,
    }
    assert saved.json() == expected
    assert client.get(PREFS).json() == expected
    # 전체 교체 — 두 번째 PUT 이 앞의 값을 덮는다
    again = client.put(PREFS, json={"read_enabled": False}, headers=XHR)
    assert again.json()["read_time"] == "06:00" and again.json()["lock_screen_level"] == "neutral"


@pytest.mark.parametrize("value", ["6:00", "25:00", "06:00:00", "06:60", "", "아침"])
def test_read_time_must_be_zero_padded_hh_mm(client: TestClient, value: str):
    _login(client, client.me)  # type: ignore[attr-defined]
    res = client.put(PREFS, json={"read_enabled": True, "read_time": value}, headers=XHR)
    assert res.status_code == 422


def test_unknown_lock_screen_level_is_422(client: TestClient):
    _login(client, client.me)  # type: ignore[attr-defined]
    res = client.put(
        PREFS, json={"read_enabled": True, "lock_screen_level": "verse"}, headers=XHR
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_subscribe_upserts_by_endpoint_and_transfers_ownership(client: TestClient, push_on):
    _login(client, client.me)  # type: ignore[attr-defined]
    first = client.post(PUSH, json=_subscription(user_agent="Mozilla/5.0"), headers=XHR)
    assert first.status_code == 201, first.text
    assert set(first.json()) == {"id", "endpoint", "created_at"}
    assert first.json()["endpoint"] == ENDPOINT

    # 같은 endpoint 재등록 — 행이 늘지 않고 키만 갱신된다
    second = client.post(PUSH, json=_subscription(p256dh="BPk2"), headers=XHR)
    assert second.status_code == 201 and second.json()["id"] == first.json()["id"]
    assert client.get(PREFS).json()["subscription_count"] == 1

    # 같은 기기를 다른 계정이 구독 — 소유가 옮겨간다
    _login(client, client.other)  # type: ignore[attr-defined]
    moved = client.post(PUSH, json=_subscription(p256dh="BPk3"), headers=XHR)
    assert moved.status_code == 201 and moved.json()["id"] == first.json()["id"]
    assert client.get(PREFS).json()["subscription_count"] == 1
    _login(client, client.me)  # type: ignore[attr-defined]
    assert client.get(PREFS).json()["subscription_count"] == 0

    session: AsyncSession = client.session  # type: ignore[attr-defined]
    rows = (await session.execute(select(PushSubscription))).scalars().all()
    assert len(rows) == 1 and rows[0].p256dh == "BPk3" and rows[0].failed_count == 0


def test_subscribe_rejects_oversized_endpoint(client: TestClient, push_on):
    _login(client, client.me)  # type: ignore[attr-defined]
    res = client.post(PUSH, json=_subscription("https://e/" + "x" * 2049), headers=XHR)
    assert res.status_code == 422


def test_subscribe_truncates_long_user_agent(client: TestClient, push_on):
    _login(client, client.me)  # type: ignore[attr-defined]
    assert client.post(PUSH, json=_subscription(user_agent="U" * 400), headers=XHR).status_code == 201
    over = client.post(PUSH, json=_subscription("https://e/2", user_agent="U" * 401), headers=XHR)
    assert over.status_code == 422  # 400자 초과는 받지 않는다


@pytest.mark.asyncio
async def test_delete_only_removes_own_subscription_and_is_idempotent(client: TestClient, push_on):
    _login(client, client.me)  # type: ignore[attr-defined]
    client.post(PUSH, json=_subscription(), headers=XHR)

    # 남의 구독 endpoint 로 요청해도 204 지만 행은 남는다
    _login(client, client.other)  # type: ignore[attr-defined]
    assert client.delete(f"{PUSH}?endpoint={ENDPOINT}", headers=XHR).status_code == 204
    _login(client, client.me)  # type: ignore[attr-defined]
    assert client.get(PREFS).json()["subscription_count"] == 1

    assert client.delete(f"{PUSH}?endpoint={ENDPOINT}", headers=XHR).status_code == 204
    assert client.get(PREFS).json()["subscription_count"] == 0
    # 없는 endpoint 도 204
    assert client.delete(f"{PUSH}?endpoint=https://nope", headers=XHR).status_code == 204


@pytest.mark.asyncio
async def test_preference_read_time_persists_as_time_column(client: TestClient):
    _login(client, client.me)  # type: ignore[attr-defined]
    client.put(PREFS, json={"read_enabled": True, "read_time": "05:45"}, headers=XHR)
    session: AsyncSession = client.session  # type: ignore[attr-defined]
    row = (await session.execute(select(NotificationPreference))).scalars().one()
    assert row.read_time == time(5, 45) and row.read_enabled is True


def test_client_errors_accept_push_subscribe_kind(client: TestClient):
    from app.modules.hoondok.journey_schemas import ClientErrorInput

    parsed = ClientErrorInput(kind="push_subscribe", path="/hoondok/settings")
    assert parsed.kind == "push_subscribe"


@pytest.mark.asyncio
async def test_account_deletion_purges_notification_rows():
    """API-HD-011 계정 삭제가 두 테이블을 함께 비운다 — purger 등록 확인(실 리포·실 라우터)."""
    from app.modules.hoondok.dependencies import get_jeongseong_repository, get_mission_repository
    from app.modules.hoondok.models import (
        ClientErrorEvent,
        JeongseongPeriod,
        JeongseongReading,
        MissionLog,
    )
    from app.modules.hoondok.repository import JeongseongRepository, MissionLogRepository
    from app.modules.identity.repository import UserRepository
    from app.modules.identity.schemas import SignupRequest

    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[
                User.__table__,
                MissionLog.__table__,
                JeongseongPeriod.__table__,
                JeongseongReading.__table__,
                ClientErrorEvent.__table__,
                NotificationPreference.__table__,
                PushSubscription.__table__,
            ],
        )
    session = AsyncSession(engine, expire_on_commit=False)
    users = UserRepository(session)
    notifications = NotificationRepository(session)
    me = await IdentityService(users).signup(
        SignupRequest(email="purge@example.com", password="password1", display_name="효진")
    )
    await notifications.save_subscription(
        PushSubscription(user_id=me.id, endpoint=ENDPOINT, p256dh="a", auth="b")
    )
    await notifications.save_preference(NotificationPreference(user_id=me.id, read_enabled=True))

    app.dependency_overrides[get_identity_repository] = lambda: users
    app.dependency_overrides[get_notification_repository] = lambda: notifications
    app.dependency_overrides[get_mission_repository] = lambda: MissionLogRepository(session)
    app.dependency_overrides[get_jeongseong_repository] = lambda: JeongseongRepository(session)
    try:
        client = TestClient(app)
        client.cookies.set(COOKIE_NAME, IdentityService.issue_token(me))
        assert client.delete("/hoondok/auth/me", headers=XHR).status_code == 204
    finally:
        for provider in (
            get_identity_repository,
            get_notification_repository,
            get_mission_repository,
            get_jeongseong_repository,
        ):
            app.dependency_overrides.pop(provider, None)

    assert (await session.execute(select(PushSubscription))).scalars().all() == []
    assert (await session.execute(select(NotificationPreference))).scalars().all() == []
    await session.close()
    await engine.dispose()
