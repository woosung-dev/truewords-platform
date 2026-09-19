"""훈독 편성 admin API-HD-006~008 — repository 범위·저장, service 404/409/422, 라우터 게이트·CSRF 배선, HTTP 흐름(편성 → today → 철회)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

from route_helpers import dependency_callables, iter_api_routes

from app.modules.admin.dependencies import get_admin_service, get_current_admin, require_admin_gate, verify_csrf
from app.modules.hoondok.dependencies import get_daily_reading_admin_service, get_hoondok_service
from app.modules.hoondok.models import DailyReading
from app.modules.hoondok.repository import DailyReadingRepository
from app.modules.hoondok.schemas import DailyReadingAdminCreate, DailyReadingAdminUpdate
from app.modules.hoondok.service import DailyReadingAdminService, HoondokService

TODAY = date(2026, 9, 19)
XHR = {"X-Requested-With": "XMLHttpRequest"}
GATE_ADMIN = {"user_id": uuid.uuid4(), "role": "admin", "email": "demo-admin@example.com"}
BASE = "/admin/hoondok/daily-readings"


def _payload(reading_date: date = TODAY, **overrides) -> dict:
    base = dict(
        reading_date=reading_date.isoformat(),
        title="참사랑은 직단거리를 갑니다",
        body="참사랑은 직단거리를 갑니다. 종적인 사랑은 90각도 한 점밖에 없습니다.",
        speaker="참아버님",
        spoken_on="1987-03-01",
        work_title="천성경",
        edition="최종본 2012년~",
        authority_grade="O1",
        review_status="reviewed",
        source_note="p.123",
    )
    base.update(overrides)
    return base


def _reading(reading_date: date = TODAY, **overrides) -> DailyReading:
    data = _payload(reading_date, **overrides)
    data["reading_date"] = reading_date
    return DailyReading(**data)


@pytest.fixture
async def repo():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[DailyReading.__table__])
    session = AsyncSession(engine, expire_on_commit=False)
    try:
        yield DailyReadingRepository(session)
    finally:
        await session.close()
        await engine.dispose()


def _app():
    with patch("app.main.init_db", new_callable=AsyncMock):
        from app.main import app
    return app


# --- repository ----------------------------------------------------------


@pytest.mark.asyncio
async def test_repo_list_range_inclusive_and_ordered(repo: DailyReadingRepository):
    for offset in (3, 0, 1, 20):
        await repo.create(_reading(TODAY + timedelta(days=offset), title=f"d+{offset}"))

    rows = await repo.list_range(TODAY, TODAY + timedelta(days=3))

    assert [r.title for r in rows] == ["d+0", "d+1", "d+3"]
    assert await repo.list_range(TODAY + timedelta(days=4), TODAY + timedelta(days=10)) == []


@pytest.mark.asyncio
async def test_repo_duplicate_date_rolls_back_and_session_stays_usable(repo: DailyReadingRepository):
    await repo.create(_reading())
    with pytest.raises(IntegrityError):
        await repo.create(_reading(title="같은 날 두 번째"))
    # 롤백됐으므로 같은 세션으로 다른 날짜는 저장된다
    saved = await repo.create(_reading(TODAY + timedelta(days=1)))
    assert await repo.get_by_id(saved.id) is not None


@pytest.mark.asyncio
async def test_repo_save_persists_changes(repo: DailyReadingRepository):
    saved = await repo.create(_reading())
    saved.title = "수정됨"
    await repo.save(saved)
    again = await repo.get_by_id(saved.id)
    assert again is not None and again.title == "수정됨"


# --- service --------------------------------------------------------------


@pytest.mark.asyncio
async def test_service_list_defaults_to_today_plus_14(repo: DailyReadingRepository):
    await repo.create(_reading(TODAY - timedelta(days=1), title="어제"))
    await repo.create(_reading(TODAY, title="오늘"))
    await repo.create(_reading(TODAY + timedelta(days=14), title="+14"))
    await repo.create(_reading(TODAY + timedelta(days=15), title="+15"))
    service = DailyReadingAdminService(repo, today_fn=lambda: TODAY)

    rows = await service.list(None, None)

    assert [r.title for r in rows] == ["오늘", "+14"]


@pytest.mark.asyncio
async def test_service_list_rejects_reversed_or_huge_range(repo: DailyReadingRepository):
    service = DailyReadingAdminService(repo, today_fn=lambda: TODAY)
    with pytest.raises(HTTPException) as reversed_range:
        await service.list(TODAY, TODAY - timedelta(days=1))
    with pytest.raises(HTTPException) as huge:
        await service.list(TODAY, TODAY + timedelta(days=367))
    assert reversed_range.value.status_code == 422 and huge.value.status_code == 422


@pytest.mark.asyncio
async def test_service_create_conflict_and_update_paths(repo: DailyReadingRepository):
    service = DailyReadingAdminService(repo, today_fn=lambda: TODAY)
    created = await service.create(DailyReadingAdminCreate(**_payload()))
    assert created.review_status == "reviewed" and created.estimated_minutes == 3
    # 409 롤백은 세션의 인스턴스를 expire 시킨다(비동기 세션에서 지연 로드 불가) → 값은 미리 복사한다
    created_id, created_title, created_updated_at = created.id, created.title, created.updated_at

    with pytest.raises(HTTPException) as dup:
        await service.create(DailyReadingAdminCreate(**_payload(title="중복")))
    assert dup.value.status_code == 409

    updated = await service.update(created_id, DailyReadingAdminUpdate(review_status="withdrawn"))
    assert updated.review_status == "withdrawn"
    assert updated.title == created_title  # 보내지 않은 필드는 유지
    assert updated.updated_at >= created_updated_at

    with pytest.raises(HTTPException) as missing:
        await service.update(uuid.uuid4(), DailyReadingAdminUpdate(title="없음"))
    assert missing.value.status_code == 404

    other = await service.create(DailyReadingAdminCreate(**_payload(TODAY + timedelta(days=1))))
    with pytest.raises(HTTPException) as date_clash:
        await service.update(other.id, DailyReadingAdminUpdate(reading_date=TODAY))
    assert date_clash.value.status_code == 409


# --- 라우터 배선 -----------------------------------------------------------


def test_all_curation_routes_have_csrf_and_admin_gate():
    """관리자 블록(_ADMIN_GATE) + 라우터 레벨 verify_csrf 가 4개 route 전부에 걸려 있다."""
    app = _app()
    routes = [
        (route, inherited)
        for route, inherited in iter_api_routes(app)
        if getattr(route, "path", "").startswith(BASE)
    ]
    assert {(route.path, m) for route, _ in routes for m in route.methods} == {
        (BASE, "GET"), (BASE, "POST"), (f"{BASE}/{{reading_id}}", "GET"), (f"{BASE}/{{reading_id}}", "PUT"),
    }
    for route, inherited in routes:
        dep_callables = dependency_callables(route, inherited)
        assert verify_csrf in dep_callables, f"{route.path} {route.methods} 에 verify_csrf 누락"
        assert require_admin_gate in dep_callables, f"{route.path} {route.methods} 에 require_admin_gate 누락"


def test_routes_reject_missing_cookie_wrong_gate_and_missing_csrf():
    app = _app()
    client = TestClient(app)

    # 쿠키 없음 → 401 (admin_token 만이 아니라 아무것도 없는 요청)
    assert client.get(BASE).status_code == 401

    # 게이트 계정이 아닌 관리자 → 403
    app.dependency_overrides[get_current_admin] = lambda: {**GATE_ADMIN, "email": "other@example.com"}
    try:
        assert client.get(BASE).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_admin, None)

    # 게이트 통과 + X-Requested-With 없음 → 403 (CSRF)
    app.dependency_overrides[get_current_admin] = lambda: GATE_ADMIN
    try:
        assert client.post(BASE, json=_payload()).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


# --- HTTP 흐름: 편성 → 공개 today → 철회 -------------------------------------


@pytest.mark.asyncio
async def test_http_flow_create_list_today_withdraw(repo: DailyReadingRepository):
    app = _app()
    admin_service = MagicMock()
    admin_service.log_audit = AsyncMock()
    app.dependency_overrides[get_current_admin] = lambda: GATE_ADMIN
    app.dependency_overrides[get_admin_service] = lambda: admin_service
    app.dependency_overrides[get_daily_reading_admin_service] = lambda: DailyReadingAdminService(
        repo, today_fn=lambda: TODAY
    )
    app.dependency_overrides[get_hoondok_service] = lambda: HoondokService(repo, today_fn=lambda: TODAY)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            created = await client.post(BASE, json=_payload(), headers=XHR)
            assert created.status_code == 201, created.text
            body = created.json()
            assert body["source_note"] == "p.123" and "created_at" in body  # 관리자 응답은 내부 필드 포함
            reading_id = body["id"]

            dup = await client.post(BASE, json=_payload(title="중복"), headers=XHR)
            assert dup.status_code == 409

            invalid = await client.post(BASE, json=_payload(authority_grade="X9"), headers=XHR)
            assert invalid.status_code == 422

            listed = await client.get(BASE)
            assert [r["id"] for r in listed.json()] == [reading_id]
            assert (await client.get(BASE, params={"from": "2026-09-19", "to": "2026-09-18"})).status_code == 422

            one = await client.get(f"{BASE}/{reading_id}")
            assert one.status_code == 200 and one.json()["title"] == body["title"]
            assert (await client.get(f"{BASE}/{uuid.uuid4()}")).status_code == 404

            today = await client.get("/hoondok/today")
            assert today.json()["status"] == "available"

            withdrawn = await client.put(f"{BASE}/{reading_id}", json={"review_status": "withdrawn"}, headers=XHR)
            assert withdrawn.status_code == 200 and withdrawn.json()["review_status"] == "withdrawn"

            today_after = await client.get("/hoondok/today")
            assert today_after.json() == {"date": "2026-09-19", "status": "withdrawn", "reading": None}
    finally:
        for dep in (get_current_admin, get_admin_service, get_daily_reading_admin_service, get_hoondok_service):
            app.dependency_overrides.pop(dep, None)

    # 감사 로그: 성공한 생성 1 + 수정 1 (409·422 는 기록하지 않는다)
    assert admin_service.log_audit.await_count == 2
    actions = [c.kwargs["action"] for c in admin_service.log_audit.await_args_list]
    assert actions == ["daily_reading.create", "daily_reading.update"]
    assert admin_service.log_audit.await_args_list[1].kwargs["changes"] == {"review_status": "withdrawn"}
