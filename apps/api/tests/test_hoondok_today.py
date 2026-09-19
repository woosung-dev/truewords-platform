"""훈독 API-HD-001 GET /hoondok/today — repository(aiosqlite)·service 3상태·KST 경계·라우터."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

from app.core.common.clock import today_kst
from app.main import app
from app.modules.hoondok.dependencies import get_hoondok_service
from app.modules.hoondok.models import DailyReading
from app.modules.hoondok.repository import DailyReadingRepository
from app.modules.hoondok.service import HoondokService

TODAY = date(2026, 9, 17)


def _reading(reading_date: date = TODAY, **overrides) -> DailyReading:
    base = dict(
        reading_date=reading_date,
        title="참사랑은 직단거리를 갑니다",
        body="참사랑은 직단거리를 갑니다. 종적인 사랑은 90각도 한 점밖에 없습니다.",
        speaker="참아버님",
        spoken_on="1987-03-01",
        work_title="천성경",
        edition="최종본 2012년~",
        authority_grade="O1",
        review_status="reviewed",
        source_note="테스트",
        chunk_id="fixture-chunk",
    )
    base.update(overrides)
    return DailyReading(**base)


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


# --- clock ---------------------------------------------------------------


def test_today_kst_rolls_over_at_utc_15():
    assert today_kst(datetime(2026, 9, 16, 14, 59, 59, tzinfo=timezone.utc)) == date(2026, 9, 16)
    assert today_kst(datetime(2026, 9, 16, 15, 0, 0, tzinfo=timezone.utc)) == date(2026, 9, 17)
    # naive 는 UTC 로 해석한다.
    assert today_kst(datetime(2026, 9, 16, 15, 0, 0)) == date(2026, 9, 17)


# --- repository ----------------------------------------------------------


@pytest.mark.asyncio
async def test_repo_get_by_date_and_unique_date(repo: DailyReadingRepository):
    await repo.create(_reading())
    found = await repo.get_by_date(TODAY)
    assert found is not None and found.title == "참사랑은 직단거리를 갑니다"
    assert await repo.get_by_date(date(2026, 9, 18)) is None
    with pytest.raises(IntegrityError):
        await repo.create(_reading(title="같은 날 두 번째"))


# --- service 3상태 ---------------------------------------------------------


@pytest.mark.asyncio
async def test_service_available_hides_internal_fields(repo: DailyReadingRepository):
    await repo.create(_reading())
    service = HoondokService(repo, today_fn=lambda: TODAY)

    response = await service.get_today()

    assert response.status == "available"
    assert response.date == TODAY
    assert response.reading is not None
    assert response.reading.authority_grade == "O1"
    dumped = response.reading.model_dump()
    assert "source_note" not in dumped and "chunk_id" not in dumped and "created_at" not in dumped


@pytest.mark.asyncio
async def test_service_none_when_not_scheduled(repo: DailyReadingRepository):
    service = HoondokService(repo, today_fn=lambda: TODAY)
    response = await service.get_today()
    assert response.status == "none" and response.reading is None


@pytest.mark.asyncio
async def test_service_withdrawn_hides_body(repo: DailyReadingRepository):
    await repo.create(_reading(review_status="withdrawn"))
    service = HoondokService(repo, today_fn=lambda: TODAY)
    response = await service.get_today()
    assert response.status == "withdrawn" and response.reading is None


# --- router --------------------------------------------------------------


def test_router_returns_200_with_status():
    class FixtureService:
        async def get_today(self):
            from app.modules.hoondok.schemas import TodayReadingResponse

            return TodayReadingResponse(date=TODAY, status="none", reading=None)

    app.dependency_overrides[get_hoondok_service] = lambda: FixtureService()
    try:
        response = TestClient(app).get("/hoondok/today")
    finally:
        app.dependency_overrides.pop(get_hoondok_service, None)

    assert response.status_code == 200
    assert response.json() == {"date": "2026-09-17", "status": "none", "reading": None}


def test_router_is_public_without_cookie():
    """admin 게이트·쿠키 없이도 401/403 이 아니다 (공개 라우터 블록)."""
    from app.modules.hoondok.schemas import DailyReadingPublic, TodayReadingResponse

    class FixtureService:
        async def get_today(self):
            return TodayReadingResponse(
                date=TODAY,
                status="available",
                reading=DailyReadingPublic(
                    id=uuid.uuid4(),
                    reading_date=TODAY,
                    title="t",
                    body="b",
                    speaker="참아버님",
                    spoken_on=None,
                    work_title="천성경",
                    edition=None,
                    authority_grade="R",
                    review_status="unverified",
                    estimated_minutes=3,
                ),
            )

    app.dependency_overrides[get_hoondok_service] = lambda: FixtureService()
    try:
        response = TestClient(app).get("/hoondok/today")
    finally:
        app.dependency_overrides.pop(get_hoondok_service, None)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "available"
    assert body["reading"]["authority_grade"] == "R"
    assert set(body["reading"]) == {
        "id", "reading_date", "title", "body", "speaker", "spoken_on",
        "work_title", "edition", "authority_grade", "review_status", "estimated_minutes",
    }
