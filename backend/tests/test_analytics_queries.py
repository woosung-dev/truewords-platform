"""Analytics /search/queries 엔드포인트 테스트."""

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

with patch("main.init_db", new_callable=AsyncMock):
    from main import app

from src.admin.analytics_repository import AnalyticsRepository
from src.admin.analytics_router import _get_repo
from src.admin.dependencies import get_current_admin


def _mock_admin():
    return {"user_id": uuid.uuid4(), "role": "admin"}


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
    app.dependency_overrides[_get_repo] = lambda: repo


def _clear_repo_override():
    app.dependency_overrides.pop(_get_repo, None)


@pytest.mark.asyncio
async def test_queries_returns_empty_when_no_match(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "size": 50,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/search/queries")
    finally:
        _clear_repo_override()

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []


@pytest.mark.asyncio
async def test_queries_returns_items_sorted_by_count_desc(
    async_client, override_admin_auth
):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [
            {
                "query_text": "36가정 축복",
                "count": 3,
                "latest_at": datetime(2026, 4, 17, 12, 34),
                "negative_feedback_count": 1,
            },
            {
                "query_text": "노조와 사조직",
                "count": 2,
                "latest_at": datetime(2026, 4, 17, 1, 3),
                "negative_feedback_count": 0,
            },
        ],
        "total": 2,
        "page": 1,
        "size": 50,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/search/queries")
    finally:
        _clear_repo_override()

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert body["items"][0]["query_text"] == "36가정 축복"
    assert body["items"][0]["count"] == 3
    assert body["items"][0]["negative_feedback_count"] == 1


@pytest.mark.asyncio
async def test_queries_respects_sort_recent_desc(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "size": 50,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/queries",
                params={"sort": "recent_desc"},
            )
    finally:
        _clear_repo_override()
    assert resp.status_code == 200
    repo.get_queries.assert_awaited_once_with(
        q="", days=30, sort="recent_desc", page=1, size=50
    )


@pytest.mark.asyncio
async def test_queries_applies_ilike_search(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "size": 50,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/queries",
                params={"q": "천일국"},
            )
    finally:
        _clear_repo_override()
    assert resp.status_code == 200
    repo.get_queries.assert_awaited_once_with(
        q="천일국", days=30, sort="count_desc", page=1, size=50
    )


@pytest.mark.asyncio
async def test_queries_paginates_with_size_and_page(
    async_client, override_admin_auth
):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [],
        "total": 120,
        "page": 3,
        "size": 20,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/queries",
                params={"page": 3, "size": 20},
            )
    finally:
        _clear_repo_override()
    body = resp.json()
    assert body["total"] == 120
    assert body["page"] == 3
    assert body["size"] == 20


@pytest.mark.asyncio
async def test_queries_rejects_invalid_sort(async_client, override_admin_auth):
    async with async_client as client:
        resp = await client.get(
            "/admin/analytics/search/queries",
            params={"sort": "invalid_value"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_queries_requires_admin_auth(async_client):
    repo = AsyncMock(spec=AnalyticsRepository)
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/search/queries")
    finally:
        _clear_repo_override()
    assert resp.status_code == 401
