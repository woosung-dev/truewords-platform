"""`POST /admin/rag-trace` 권한·CSRF·동시 실행 제한."""

from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

with patch("app.main.init_db", new_callable=AsyncMock):
    from app.main import app

from app.modules.admin.dependencies import get_current_admin, require_admin_gate, verify_csrf
from app.modules.chat.dependencies import get_rag_trace_service
from app.modules.chat.trace_schemas import RagTraceResponse, TraceTotals
from route_helpers import dependency_callables, iter_api_routes

_CSRF = {"X-Requested-With": "XMLHttpRequest"}
_BODY = {"query": "참사랑이란?"}


def _admin(email: str = "demo-admin@example.com") -> dict:
    return {"user_id": uuid.uuid4(), "role": "admin", "email": email}


def _empty_response() -> RagTraceResponse:
    return RagTraceResponse(
        totals=TraceTotals(total_ms=0, critical_path_ms=0, llm_calls=0, input_tokens=0, output_tokens=0)
    )


class _BlockingService:
    """release 될 때까지 실행 중으로 머무는 가짜 서비스 — 동시 실행 슬롯 검사용."""

    def __init__(self) -> None:
        self.started = 0
        self.release = asyncio.Event()

    async def run(self, req):
        self.started += 1
        await self.release.wait()
        return _empty_response()


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
def fake_service():
    svc = _BlockingService()
    app.dependency_overrides[get_rag_trace_service] = lambda: svc
    yield svc
    app.dependency_overrides.pop(get_rag_trace_service, None)


def test_route_is_wired_with_admin_gate_and_csrf() -> None:
    routes = [(r, inh) for r, inh in iter_api_routes(app) if getattr(r, "path", "") == "/admin/rag-trace"]
    assert len(routes) == 1
    calls = dependency_callables(*routes[0])
    assert {require_admin_gate, verify_csrf, get_current_admin} <= calls


@pytest.mark.asyncio
async def test_anonymous_gets_401(client, fake_service) -> None:
    async with client as c:
        resp = await c.post("/admin/rag-trace", json=_BODY, headers=_CSRF)
    assert resp.status_code == 401
    assert fake_service.started == 0


@pytest.mark.asyncio
async def test_logged_in_non_gate_admin_gets_403(client, fake_service) -> None:
    app.dependency_overrides[get_current_admin] = lambda: _admin("someone@example.com")
    try:
        async with client as c:
            resp = await c.post("/admin/rag-trace", json=_BODY, headers=_CSRF)
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
    assert resp.status_code == 403
    assert fake_service.started == 0


@pytest.mark.asyncio
async def test_missing_csrf_header_gets_403(client, fake_service) -> None:
    app.dependency_overrides[get_current_admin] = _admin
    try:
        async with client as c:
            resp = await c.post("/admin/rag-trace", json=_BODY)
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "CSRF 검증 실패"
    assert fake_service.started == 0


@pytest.mark.asyncio
async def test_third_concurrent_request_gets_429(client, fake_service) -> None:
    app.dependency_overrides[get_current_admin] = _admin
    try:
        async with client as c:
            first = asyncio.create_task(c.post("/admin/rag-trace", json=_BODY, headers=_CSRF))
            second = asyncio.create_task(c.post("/admin/rag-trace", json=_BODY, headers=_CSRF))
            for _ in range(100):
                if fake_service.started == 2:
                    break
                await asyncio.sleep(0.01)
            assert fake_service.started == 2

            third = await c.post("/admin/rag-trace", json=_BODY, headers=_CSRF)
            assert third.status_code == 429

            fake_service.release.set()
            assert (await first).status_code == 200
            assert (await second).status_code == 200
            # 슬롯이 풀리면 다시 받는다.
            again = await c.post("/admin/rag-trace", json=_BODY, headers=_CSRF)
            assert again.status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
