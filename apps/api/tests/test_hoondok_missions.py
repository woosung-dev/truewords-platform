"""훈독 API-HD-004·005 — 연속일 순수 함수 · mission_logs unique · 라우터 401/409/422 · admin_token 거부."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from unittest.mock import MagicMock

from app.main import app
from app.modules.admin.auth import create_access_token
from app.modules.hoondok.dependencies import get_mission_repository
from app.modules.hoondok.models import MissionLog
from app.modules.hoondok.repository import MissionLogRepository
from app.modules.hoondok.schemas import TodayFlags
from app.modules.hoondok.service import MissionService
from app.modules.hoondok.streak import best_streak, compute_summary, current_streak, week_of
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.service import IdentityService

TODAY = date(2026, 9, 17)  # 목요일
XHR = {"X-Requested-With": "XMLHttpRequest"}


def _days(*offsets: int) -> set[date]:
    return {TODAY + timedelta(days=o) for o in offsets}


# --- streak 순수 함수 --------------------------------------------------------


def test_streak_empty_and_today_only():
    assert current_streak(set(), TODAY) == 0
    assert best_streak(set()) == 0
    assert current_streak(_days(0), TODAY) == 1


def test_streak_counts_from_yesterday_when_today_not_done_yet():
    assert current_streak(_days(-1, -2, -3), TODAY) == 3
    assert current_streak(_days(0, -1, -2), TODAY) == 3


def test_streak_breaks_on_gap_and_best_is_max_run():
    dates = _days(0, -1, -3, -4, -5, -6)
    assert current_streak(dates, TODAY) == 2
    assert best_streak(dates) == 4
    assert current_streak(_days(-2, -3), TODAY) == 0  # 어제 비었으면 0


def test_week_starts_monday_and_marks_done():
    week = week_of(TODAY, _days(0, -3))
    assert [d.date for d in week][0] == date(2026, 9, 14) and week[0].date.weekday() == 0
    assert [d.done for d in week] == [True, False, False, True, False, False, False]
    # 일요일이면 그 주 월요일부터
    assert week_of(date(2026, 9, 20), set())[0].date == date(2026, 9, 14)


def test_compute_summary_shape():
    s = compute_summary(_days(0, -1), TODAY, TodayFlags(read=True))
    assert (s.streak_days, s.best_streak_days, s.total_days) == (2, 2, 2)
    assert len(s.week) == 7 and s.today.read and not s.today.pray


# --- repository (aiosqlite) ---------------------------------------------------


@pytest.fixture
async def repo():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[User.__table__, MissionLog.__table__])
    session = AsyncSession(engine, expire_on_commit=False)
    try:
        yield MissionLogRepository(session)
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_repo_unique_per_user_date_kind(repo: MissionLogRepository):
    user_id = uuid.uuid4()
    await repo.create(MissionLog(user_id=user_id, mission_date=TODAY, kind="read"))
    await repo.create(MissionLog(user_id=user_id, mission_date=TODAY, kind="pray"))
    await repo.create(MissionLog(user_id=uuid.uuid4(), mission_date=TODAY, kind="read"))
    with pytest.raises(IntegrityError):
        await repo.create(MissionLog(user_id=user_id, mission_date=TODAY, kind="read"))
    assert await repo.list_dates(user_id, "read") == [TODAY]
    assert await repo.kinds_on(user_id, TODAY) == {"read", "pray"}


@pytest.mark.asyncio
async def test_service_complete_then_409_and_summary_streak_1(repo: MissionLogRepository):
    service = MissionService(repo, today_fn=lambda: TODAY)
    user_id = uuid.uuid4()
    done = await service.complete(user_id, "read")
    assert done.mission_date == TODAY and done.kind == "read"
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await service.complete(user_id, "read")
    assert exc.value.status_code == 409
    summary = await service.summary(user_id)
    assert summary.streak_days == 1 and summary.total_days == 1 and summary.today.read is True
    assert summary.week[TODAY.weekday()].done is True


# --- router --------------------------------------------------------------


class _Users:
    def __init__(self, user: User) -> None:
        self.user = user

    async def get_by_id(self, user_id):
        return self.user if user_id == self.user.id else None


class _Logs:
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

    async def kinds_on(self, user_id, mission_date):
        return {k for u, d, k in self.rows if u == user_id and d == mission_date}


@pytest.fixture
def client():
    user = User(email="a@b.c", password_hash="x", display_name="효진")
    logs = _Logs()
    app.dependency_overrides[get_identity_repository] = lambda: _Users(user)
    app.dependency_overrides[get_mission_repository] = lambda: logs
    try:
        c = TestClient(app)
        c.hoondok_user = user  # type: ignore[attr-defined]
        yield c
    finally:
        app.dependency_overrides.pop(get_identity_repository, None)
        app.dependency_overrides.pop(get_mission_repository, None)


def test_complete_requires_hoondok_cookie_and_rejects_admin_token(client: TestClient):
    assert client.post("/hoondok/missions/read/complete", headers=XHR).status_code == 401
    assert client.get("/hoondok/me/summary").status_code == 401
    admin = create_access_token({"sub": str(client.hoondok_user.id), "role": "admin", "email": "admin@test.com"})
    client.cookies.set("admin_token", admin)
    assert client.post("/hoondok/missions/read/complete", headers=XHR).status_code == 401
    assert client.get("/hoondok/me/summary").status_code == 401
    # 훈독 쿠키 자리에 admin 토큰을 넣어도 aud 가 없어 거부
    client.cookies.set(COOKIE_NAME, admin)
    assert client.post("/hoondok/missions/read/complete", headers=XHR).status_code == 401


def test_complete_flow_201_409_422_and_summary(client: TestClient):
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(client.hoondok_user))
    first = client.post("/hoondok/missions/read/complete", headers=XHR)
    assert first.status_code == 201, first.text
    assert set(first.json()) == {"mission_date", "kind", "completed_at"} and first.json()["kind"] == "read"
    assert client.post("/hoondok/missions/read/complete", headers=XHR).status_code == 409
    assert client.post("/hoondok/missions/nap/complete", headers=XHR).status_code == 422
    assert client.post("/hoondok/missions/read/complete").status_code == 403  # CSRF 헤더 없음

    summary = client.get("/hoondok/me/summary")
    assert summary.status_code == 200
    body = summary.json()
    assert body["today"] == {"read": True, "pray": False, "study": False}
    assert body["streak_days"] == 1 and body["best_streak_days"] == 1 and body["total_days"] == 1
    assert len(body["week"]) == 7 and sum(d["done"] for d in body["week"]) == 1
    assert body["week"][0]["date"] < body["week"][6]["date"]
