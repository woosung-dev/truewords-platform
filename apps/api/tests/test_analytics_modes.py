# BL-6 — /admin/analytics/modes/daily 엔드포인트 + 일별 mode 분포 집계 검증
"""Analytics /modes/daily 엔드포인트 테스트."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

with patch("app.main.init_db", new_callable=AsyncMock):
    from app.main import app

from app.modules.admin.analytics_repository import AnalyticsRepository
from app.modules.admin.dependencies import get_analytics_repository
from app.modules.admin.dependencies import get_current_admin


def _mock_admin():
    return {"user_id": uuid.uuid4(), "role": "admin", "email": "jangwooseng97@gmail.com"}


@pytest.fixture
def async_client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def override_admin_auth():
    app.dependency_overrides[get_current_admin] = _mock_admin
    yield
    app.dependency_overrides.pop(get_current_admin, None)


def _override_repo(repo: AsyncMock):
    app.dependency_overrides[get_analytics_repository] = lambda: repo


def _clear_repo_override():
    app.dependency_overrides.pop(get_analytics_repository, None)


@pytest.mark.asyncio
async def test_daily_modes_returns_empty_when_no_data(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_daily_modes.return_value = []
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/modes/daily")
    finally:
        _clear_repo_override()

    assert resp.status_code == 200
    assert resp.json() == []
    repo.get_daily_modes.assert_awaited_once_with(30)


@pytest.mark.asyncio
async def test_daily_modes_returns_flat_list(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_daily_modes.return_value = [
        {"date": "2026-05-13", "mode": "standard", "persona_overridden": False, "count": 42},
        {"date": "2026-05-13", "mode": "pastoral", "persona_overridden": True, "count": 3},
        {"date": "2026-05-14", "mode": "kids", "persona_overridden": False, "count": 7},
        # codex P2 — NULL 보존: 측정값 없음/legacy 와 명시적 false 분리
        {"date": "2026-05-14", "mode": "standard", "persona_overridden": None, "count": 5},
    ]
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/modes/daily")
    finally:
        _clear_repo_override()

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 4
    assert body[0] == {
        "date": "2026-05-13",
        "mode": "standard",
        "persona_overridden": False,
        "count": 42,
    }
    assert body[1]["mode"] == "pastoral"
    assert body[1]["persona_overridden"] is True
    assert body[3]["persona_overridden"] is None


@pytest.mark.asyncio
async def test_daily_modes_passes_days_parameter(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_daily_modes.return_value = []
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/modes/daily", params={"days": 7})
    finally:
        _clear_repo_override()
    assert resp.status_code == 200
    repo.get_daily_modes.assert_awaited_once_with(7)


@pytest.mark.asyncio
async def test_daily_modes_rejects_days_below_one(async_client, override_admin_auth):
    async with async_client as client:
        resp = await client.get("/admin/analytics/modes/daily", params={"days": 0})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_daily_modes_rejects_days_above_max(async_client, override_admin_auth):
    async with async_client as client:
        resp = await client.get("/admin/analytics/modes/daily", params={"days": 400})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_daily_modes_requires_admin_auth(async_client):
    repo = AsyncMock(spec=AnalyticsRepository)
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/modes/daily")
    finally:
        _clear_repo_override()
    assert resp.status_code == 401
