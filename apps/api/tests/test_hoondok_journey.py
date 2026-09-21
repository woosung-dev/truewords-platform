"""권리·정성·원문 연결과 개인정보 경계 회귀."""

import logging
import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.main import app
from app.core.common.middleware import HoondokAccessLogFilter
from app.modules.hoondok.client_errors import ClientErrorService, normalize_error_path
from app.modules.hoondok.dependencies import get_journey_service
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_schemas import ClientErrorInput, ContentRightInput
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.models import (
    ClientErrorEvent,
    ContentRight,
    JeongseongPeriod,
    JeongseongReading,
)
from app.modules.hoondok.repository import JeongseongRepository
from app.modules.identity.models import User
from app.modules.qdrant import QdrantPoint
from app.modules.search.exceptions import SearchFailedError
from app.modules.search.hybrid import SearchResult, hybrid_search

TODAY = date(2026, 9, 21)
BODY = "감사하는 마음으로 하루를 시작하고 서로를 존중하며 작은 일에서도 사랑을 실천하는 삶을 살아가야 합니다."


@pytest.fixture
async def setup():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[
                User.__table__,
                ContentRight.__table__,
                JeongseongPeriod.__table__,
                JeongseongReading.__table__,
                ClientErrorEvent.__table__,
            ],
        )
    async with AsyncSession(engine, expire_on_commit=False) as session:
        client = AsyncMock()
        search = AsyncMock(return_value=[])
        svc = JourneyService(
            JourneyRepository(session),
            client,
            JeongseongRepository(session),
            today_fn=lambda: TODAY,
            search_fn=search,
        )
        yield session, svc, client, search
    await engine.dispose()


async def right(svc, volume="v", **kwargs):
    return await svc.save_right(
        ContentRightInput(
            volume=volume, work_title="표시 제목", status="allowed", **kwargs
        )
    )


async def period(session, offset=0):
    user = User(
        email=f"{uuid.uuid4()}@test.com", display_name="식구", password_hash="test"
    )
    session.add(user)
    p = JeongseongPeriod(
        user_id=user.id,
        topic="감사",
        started_on=TODAY + timedelta(days=offset),
        duration_days=7,
    )
    session.add(p)
    await session.commit()
    return p


@pytest.mark.asyncio
async def test_empty_allowlist_shortcircuits(setup):
    _, svc, _, search = setup
    assert (await svc.library()).items == []
    assert (await svc.search("감사", 20)).results == []
    search.assert_not_called()


@pytest.mark.asyncio
async def test_search_only_rights_have_no_full_text(setup):
    _, svc, _, search = setup
    await right(svc, scope_search=True)
    assert not (await svc.library()).items[0].scope_full_text
    search.return_value = [SearchResult(BODY, "v", 0, 0.4, chunk_id="1")]
    assert not (await svc.search("감사", 20)).results[0].can_read_full_text
    assert search.call_args.kwargs["volume_filter"] == ["v"]
    with pytest.raises(HTTPException) as exc:
        await svc.words("v", 1, None)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_search_rechecks_revoked_rights(setup):
    _, svc, _, search = setup
    record = await right(svc, scope_search=True)

    async def revoke(*args, **kwargs):
        record.status = "withdrawn"
        await svc.repo.save_right(record)
        return [SearchResult(BODY, "v", 0, 0.4, chunk_id="1")]

    search.side_effect = revoke
    assert (await svc.search("감사", 20)).results == []


@pytest.mark.asyncio
async def test_right_volume_unique(setup):
    _, svc, _, _ = setup
    await right(svc)
    with pytest.raises(HTTPException) as exc:
        await right(svc)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_words_locates_chunk_page_and_orders_without_parent(setup):
    _, svc, client, _ = setup
    await right(svc, scope_full_text=True)
    client.retrieve.return_value = [
        QdrantPoint(25, 0, {"volume": "v", "chunk_index": 24})
    ]
    client.count.return_value = 25
    client.scroll.return_value = (
        [
            QdrantPoint(
                i,
                0,
                {
                    "volume": "v",
                    "chunk_index": i,
                    "text": str(i),
                    "parent_text": "LEAK",
                },
            )
            for i in range(24, 19, -1)
        ],
        None,
    )
    response = await svc.words("v", 1, "25")
    assert response.page == 2 and response.total_pages == 2
    assert [c.chunk_index for c in response.chunks] == list(range(20, 25))
    assert "LEAK" not in response.body
    assert client.scroll.call_args.kwargs["scroll_filter"]["must"][1]["range"] == {
        "gte": 20,
        "lt": 40,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("chunk_id", ["invalid", "18446744073709551616", "-1"])
async def test_invalid_chunk_is_404(setup, chunk_id):
    _, svc, client, _ = setup
    await right(svc, scope_full_text=True)
    with pytest.raises(HTTPException) as exc:
        await svc.words("v", 1, chunk_id)
    assert exc.value.status_code == 404
    client.retrieve.assert_not_called()


@pytest.mark.asyncio
async def test_other_volume_chunk_is_404(setup):
    _, svc, client, _ = setup
    await right(svc, scope_full_text=True)
    client.retrieve.return_value = [
        QdrantPoint(1, 0, {"volume": "other", "chunk_index": 0})
    ]
    with pytest.raises(HTTPException) as exc:
        await svc.words("v", 1, "1")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_jeongseong_only_is_private_stable_unverified_and_revocable(setup):
    session, svc, _, search = setup
    p = await period(session)
    r = await right(svc, scope_jeongseong=True)
    assert (await svc.library()).items == []
    assert (await svc.search("감사", 20)).results == []
    with pytest.raises(HTTPException) as exc:
        await svc.words("v", 1, None)
    assert exc.value.status_code == 404
    search.return_value = [SearchResult(BODY, "v", 0, 0.4, chunk_id="1")]
    first = await svc.today(p.user_id)
    second = await svc.today(p.user_id)
    assert first.reading.id == second.reading.id
    assert (
        first.reading.review_status == "unverified"
        and first.reading.speaker == "확인되지 않음"
    )
    search.assert_awaited_once()
    r.scope_jeongseong = False
    await svc.repo.save_right(r)
    withdrawn = await svc.today(p.user_id)
    assert withdrawn.status == "withdrawn" and withdrawn.reading is None


@pytest.mark.asyncio
async def test_personalized_excludes_used_chunk_and_body(setup):
    session, svc, _, search = setup
    p = await period(session)
    period_id = p.id
    await right(svc, scope_jeongseong=True)
    search.return_value = [SearchResult(BODY, "v", 0, 0.4, chunk_id="1")]
    await svc.today(p.user_id)
    svc.today_fn = lambda: TODAY + timedelta(days=1)
    search.return_value = [SearchResult(BODY, "v", 1, 0.4, chunk_id="2")]
    assert (await svc.today(p.user_id)).reason == "no_candidates"
    assert len(await svc.repo.list_readings(period_id)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("offset,reason", [(1, "upcoming"), (-7, "no_period")])
async def test_future_and_expired_do_not_search(setup, offset, reason):
    session, svc, _, search = setup
    p = await period(session, offset)
    assert (await svc.today(p.user_id)).reason == reason
    search.assert_not_called()


@pytest.mark.asyncio
async def test_abandoned_during_search_does_not_save(setup):
    session, svc, _, search = setup
    p = await period(session)
    period_id = p.id
    await right(svc, scope_jeongseong=True)

    async def abandon(*args, **kwargs):
        p.status = "abandoned"
        await session.commit()
        return [SearchResult(BODY, "v", 0, 0.4, chunk_id="1")]

    search.side_effect = abandon
    assert (await svc.today(p.user_id)).reason == "no_period"
    assert await svc.repo.list_readings(period_id) == []


@pytest.mark.asyncio
async def test_search_failure_does_not_expose_query(setup):
    _, svc, _, search = setup
    await right(svc, scope_search=True)
    search.side_effect = RuntimeError("private query=SECRET")
    with pytest.raises(SearchFailedError) as exc:
        await svc.search("SECRET", 20)
    assert "SECRET" not in str(exc.value)


@pytest.mark.asyncio
async def test_both_prefetch_volume_filter_and_legacy_unchanged():
    client = AsyncMock()
    client.query_points.return_value = []
    assert await hybrid_search(client, "q", volume_filter=[]) == []
    client.query_points.assert_not_called()
    await hybrid_search(
        client,
        "q",
        source_filter=["O"],
        volume_filter=["v"],
        dense_embedding=[1.0],
        sparse_embedding=([1], [1.0]),
    )
    kwargs = client.query_points.call_args.kwargs
    assert all(p["filter"] == kwargs["query_filter"] for p in kwargs["prefetch"])
    await hybrid_search(
        client,
        "q",
        source_filter=["O"],
        dense_embedding=[1.0],
        sparse_embedding=([1], [1.0]),
    )
    assert all(
        "filter" not in p and p["limit"] == 50
        for p in client.query_points.call_args.kwargs["prefetch"]
    )


@pytest.mark.asyncio
async def test_error_saves_only_safe_fields(setup):
    session, svc, _, _ = setup
    await ClientErrorService(svc.repo).record(
        ClientErrorInput(kind="api_5xx", path="/hoondok/words/private?q=SECRET"), None
    )
    row = (await session.execute(select(ClientErrorEvent))).scalar_one()
    assert (
        row.path == "/hoondok/words/:id"
        and row.message == "API 서비스 오류"
        and row.user_id is None
    )


@pytest.mark.parametrize(
    "path,expected",
    [
        ("/hoondok/search?q=SECRET", "/hoondok/search"),
        ("/hoondok/ask/private", "/hoondok/ask/:id"),
        ("/other/SECRET", "/hoondok"),
        ("http://[bad", "/hoondok"),
    ],
)
def test_safe_path(path, expected):
    assert normalize_error_path(path) == expected


def test_access_log_scrubs_query_even_on_failure():
    record = logging.LogRecord(
        "uvicorn.access",
        20,
        "",
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1", "GET", "/hoondok/search?q=SECRET", "1.1", 503),
        None,
    )
    HoondokAccessLogFilter().filter(record)
    assert "SECRET" not in record.getMessage()


def test_today_rejects_admin_cookie_and_failure_is_503():
    svc = AsyncMock()
    svc.search.side_effect = SearchFailedError("safe")
    app.dependency_overrides[get_journey_service] = lambda: svc
    try:
        client = TestClient(app)
        client.cookies.set("admin_token", "fake")
        assert client.get("/hoondok/me/jeongseong/today").status_code == 401
        assert client.get("/hoondok/search?q=hello").status_code == 503
    finally:
        app.dependency_overrides.pop(get_journey_service, None)


@pytest.mark.asyncio
async def test_same_day_race_returns_winner(setup):
    session, svc, _, _ = setup
    p = await period(session)
    first = await svc.repo.save_reading(
        JeongseongReading(
            period_id=p.id,
            reading_date=TODAY,
            volume="v",
            chunk_id="1",
            body=BODY,
            title="감사",
            work_title="말씀",
        )
    )
    second = await svc.repo.save_reading(
        JeongseongReading(
            period_id=p.id,
            reading_date=TODAY,
            volume="v",
            chunk_id="2",
            body="다른 본문",
            title="감사",
            work_title="말씀",
        )
    )
    assert first.id == second.id and second.chunk_id == "1"


@pytest.mark.asyncio
async def test_admin_gate_csrf_audit_and_withdrawal(setup):
    from httpx import AsyncClient, ASGITransport
    from app.modules.admin.dependencies import get_current_admin, get_admin_service
    from app.core.config import settings

    _, svc, _, _ = setup
    admin = {"user_id": str(uuid.uuid4()), "email": settings.demo_admin_email}
    audit = AsyncMock()
    deps = {
        get_current_admin: lambda: admin,
        get_admin_service: lambda: audit,
        get_journey_service: lambda: svc,
    }
    app.dependency_overrides.update(deps)
    base = "/admin/hoondok/content-rights"
    data = {
        "volume": "v",
        "work_title": "표시",
        "status": "allowed",
        "scope_full_text": True,
    }
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert (await client.post(base, json=data)).status_code == 403
            created = await client.post(
                base, json=data, headers={"X-Requested-With": "XMLHttpRequest"}
            )
            assert created.status_code == 201, created.text
            assert (
                await client.post(
                    base, json=data, headers={"X-Requested-With": "XMLHttpRequest"}
                )
            ).status_code == 409
            assert len((await client.get("/hoondok/library")).json()["items"]) == 1
            updated = await client.put(
                base + "/" + created.json()["id"],
                json={**data, "status": "withdrawn"},
                headers={"X-Requested-With": "XMLHttpRequest"},
            )
            assert updated.status_code == 200
            assert (await client.get("/hoondok/library")).json()["items"] == []
            assert audit.log_audit.await_count == 2
            admin["email"] = "unauthorized@test.com"
            assert (await client.get(base)).status_code == 403
    finally:
        for dep in deps:
            app.dependency_overrides.pop(dep, None)


def test_admin_no_cookie_is_401():
    assert TestClient(app).get("/admin/hoondok/content-rights").status_code == 401


@pytest.mark.asyncio
async def test_client_error_rate_limit_separate_and_optional_identity(setup):
    from httpx import AsyncClient, ASGITransport
    from app.modules.hoondok.client_errors import (
        error_limiter,
        get_client_error_service,
    )
    from app.modules.identity.dependencies import get_optional_user
    from app.modules.safety.rate_limiter import get_rate_limiter

    session, svc, _, _ = setup
    error_limiter.reset()
    get_rate_limiter().reset()
    deps = {
        get_client_error_service: lambda: ClientErrorService(svc.repo),
        get_optional_user: lambda: None,
    }
    app.dependency_overrides.update(deps)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            payload = {"kind": "api_5xx", "path": "/hoondok/search?q=SECRET"}
            headers = {"X-Requested-With": "XMLHttpRequest"}
            for _ in range(20):
                assert (
                    await client.post(
                        "/hoondok/client-errors", json=payload, headers=headers
                    )
                ).status_code == 204
            assert (
                await client.post(
                    "/hoondok/client-errors", json=payload, headers=headers
                )
            ).status_code == 429
            assert len(get_rate_limiter()._requests) == 0
            error_limiter.reset()
            assert (
                await client.post(
                    "/hoondok/client-errors",
                    json={**payload, "message": "SECRET"},
                    headers=headers,
                )
            ).status_code == 422
            assert (
                await client.post("/hoondok/client-errors", json=payload)
            ).status_code == 403
    finally:
        for dep in deps:
            app.dependency_overrides.pop(dep, None)
        error_limiter.reset()
