"""훈독 공식 정성 admin API-HD-042 · 모임 admin API-HD-043 — 게이트·CSRF 배선, CRUD, 감사 로그, 비노출 필드 (PLAN-HD-010)."""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from route_helpers import dependency_callables, iter_api_routes

from app.core.common.database import get_async_session
from app.core.config import settings
from app.main import app
from app.modules.admin.dependencies import get_current_admin, require_admin_gate, verify_csrf
from app.modules.admin.models import AdminAuditLog
from app.modules.hoondok.models import GroupMember, GroupShare, ReadingGroup, SharedJeongseong, ShareReaction
from app.modules.identity.models import User

XHR = {"X-Requested-With": "XMLHttpRequest"}
ADMIN_ID = uuid.uuid4()
JS = "/admin/hoondok/jeongseongs"
GROUPS = "/admin/hoondok/groups"


@pytest.fixture
async def ctx():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    tables = [User, ReadingGroup, GroupMember, SharedJeongseong, GroupShare, ShareReaction, AdminAuditLog]
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[t.__table__ for t in tables])
    session = AsyncSession(engine, expire_on_commit=False)

    async def _session():
        yield session

    app.dependency_overrides[get_async_session] = _session
    app.dependency_overrides[get_current_admin] = lambda: {"user_id": ADMIN_ID, "email": settings.demo_admin_email}
    client = TestClient(app)
    client.session = session  # type: ignore[attr-defined]
    try:
        yield client
    finally:
        app.dependency_overrides.pop(get_async_session, None)
        app.dependency_overrides.pop(get_current_admin, None)
        await session.close()
        await engine.dispose()


async def _audit_actions(session: AsyncSession) -> list[str]:
    rows = (await session.execute(select(AdminAuditLog).order_by(AdminAuditLog.created_at))).scalars().all()
    return [row.action for row in rows]


def test_admin_routes_have_gate_and_csrf():
    routes = [
        (route, inherited)
        for route, inherited in iter_api_routes(app)
        if getattr(route, "path", "").startswith((JS, GROUPS))
    ]
    assert {(route.path, m) for route, _ in routes for m in route.methods} == {
        (JS, "GET"),
        (JS, "POST"),
        (f"{JS}/{{jeongseong_id}}", "PUT"),
        (f"{JS}/{{jeongseong_id}}", "DELETE"),
        (GROUPS, "GET"),
        (f"{GROUPS}/{{group_id}}", "DELETE"),
    }
    for route, inherited in routes:
        deps = dependency_callables(route, inherited)
        assert verify_csrf in deps and require_admin_gate in deps, route.path


def test_admin_routes_reject_missing_cookie_and_wrong_admin():
    client = TestClient(app)
    assert client.get(JS).status_code == 401
    assert client.get(GROUPS).status_code == 401
    app.dependency_overrides[get_current_admin] = lambda: {"user_id": ADMIN_ID, "email": "other@example.com"}
    try:
        assert client.get(JS).status_code == 403
        assert client.delete(f"{GROUPS}/{uuid.uuid4()}", headers=XHR).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


async def test_official_jeongseong_crud_with_audit(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    payload = {"title": " 협회 40일 정성 ", "started_on": "2026-10-01", "duration_days": 40, "source_note": "협회 공지"}
    assert ctx.post(JS, json=payload).status_code == 403  # CSRF
    created = ctx.post(JS, json=payload, headers=XHR)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["title"] == "협회 40일 정성" and body["source_note"] == "협회 공지"
    jid = body["id"]

    for bad in ({**payload, "title": "가" * 41}, {**payload, "duration_days": 0}, {**payload, "duration_days": 101}):
        assert ctx.post(JS, json=bad, headers=XHR).status_code == 422

    assert [j["id"] for j in ctx.get(JS).json()] == [jid]
    updated = ctx.put(f"{JS}/{jid}", json={**payload, "title": "21일 정성", "duration_days": 21}, headers=XHR)
    assert updated.status_code == 200 and updated.json()["duration_days"] == 21

    # 모임 정성은 admin 공식 정성 API 로 보이지도 바뀌지도 않는다
    group_js = SharedJeongseong(group_id=uuid.uuid4(), title="모임 것", started_on=date(2026, 9, 23), duration_days=7)
    session.add(group_js)
    await session.commit()
    assert [j["id"] for j in ctx.get(JS).json()] == [jid]
    assert ctx.put(f"{JS}/{group_js.id}", json=payload, headers=XHR).status_code == 404
    assert ctx.delete(f"{JS}/{group_js.id}", headers=XHR).status_code == 404
    assert ctx.delete(f"{JS}/{uuid.uuid4()}", headers=XHR).status_code == 404

    assert ctx.delete(f"{JS}/{jid}", headers=XHR).status_code == 204
    assert ctx.get(JS).json() == []
    assert await _audit_actions(session) == [
        "official_jeongseong.create",
        "official_jeongseong.update",
        "official_jeongseong.delete",
    ]


async def test_admin_group_list_hides_member_names_and_delete_cascades(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    user = User(email="a@example.com", password_hash="x", display_name="계정이름")
    group = ReadingGroup(name="새벽 모임", invite_code="ABCD-EFGH", invite_expires_at=datetime(2026, 10, 23))
    session.add_all([user, group])
    await session.commit()
    member = GroupMember(group_id=group.id, user_id=user.id, display_name="모임이름", role="leader")
    session.add(member)
    await session.commit()
    share = GroupShare(group_id=group.id, member_id=member.id, share_date=date(2026, 9, 23), body="비밀 한 줄")
    session.add(share)
    await session.commit()

    listed = ctx.get(GROUPS)
    assert listed.status_code == 200
    assert [set(item) for item in listed.json()] == [{"id", "name", "member_count", "created_at"}]
    assert listed.json()[0]["member_count"] == 1
    text = json.dumps(listed.json(), ensure_ascii=False)
    for secret in ("모임이름", "계정이름", "비밀 한 줄", "ABCD-EFGH", str(user.id)):
        assert secret not in text

    assert ctx.delete(f"{GROUPS}/{group.id}", headers=XHR).status_code == 204
    assert ctx.get(GROUPS).json() == []
    assert (await session.execute(select(GroupShare))).first() is None
    assert (await session.execute(select(GroupMember))).first() is None
    assert ctx.delete(f"{GROUPS}/{group.id}", headers=XHR).status_code == 404
    assert await _audit_actions(session) == ["reading_group.delete"]
