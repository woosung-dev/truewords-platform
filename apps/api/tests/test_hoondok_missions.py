"""훈독 API-HD-004·005 — 연속일 순수 함수(편성 없는 날 건너뛰기 포함) · mission_logs unique · 라우터 401/409/422 · admin_token 거부."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from unittest.mock import MagicMock

from app.core.common.clock import today_kst
from app.main import app
from app.modules.admin.auth import create_access_token
from app.modules.hoondok.dependencies import get_hoondok_repository, get_mission_repository
from app.modules.hoondok.models import DailyReading, MissionLog
from app.modules.hoondok.repository import DailyReadingRepository, MissionLogRepository
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


def _day(offset: int) -> date:
    return TODAY + timedelta(days=offset)


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


# --- C3 S1: 편성 없는 날은 끊지도 늘리지도 않는다 ---------------------------------


def test_streak_skips_unscheduled_gap_between_reads():
    done, skip = _days(-1, -2, -4, -5), _days(-3)
    assert current_streak(done, TODAY) == 2  # 기존 규칙: 빈 날에서 끊긴다
    assert current_streak(done, TODAY, skip) == 4  # 건너뛰되 빈 날 자체는 세지 않는다
    assert best_streak(done, skip) == 4


def test_streak_today_unscheduled_keeps_yesterdays_run():
    # 오늘 편성 없음(미완료) → 어제까지의 연속 그대로
    assert current_streak(_days(-1, -2), TODAY, _days(0)) == 2
    # 오늘·어제 모두 편성 없음 → 그 전까지의 연속 그대로
    assert current_streak(_days(-2, -3), TODAY, _days(0, -1)) == 2


def test_streak_scheduled_but_not_done_still_breaks():
    # -2 는 편성이 있었는데 안 읽었다(skip 에 없음) → 끊긴다
    done = _days(-1, -3, -4)
    assert current_streak(done, TODAY, _days(-5)) == 1
    assert best_streak(done, _days(-5)) == 2


def test_best_streak_bridges_only_unscheduled_gaps():
    done = _days(-10, -9, -7, -6, -1)
    skip = _days(-8)  # -5~-2 는 편성 있음·미완료
    assert best_streak(done) == 2
    assert best_streak(done, skip) == 4
    assert current_streak(done, TODAY, skip) == 1


def test_streak_read_on_unscheduled_day_still_counts():
    # [가정] 정성 진행자는 공식 편성이 없는 날에도 정성 말씀을 읽는다 — 읽은 날은 편성과 상관없이 센다
    assert current_streak(_days(0, -1), TODAY, _days(0, -1)) == 2
    assert best_streak(_days(0, -1), _days(0, -1)) == 2


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
        await conn.run_sync(
            SQLModel.metadata.create_all, tables=[User.__table__, MissionLog.__table__, DailyReading.__table__]
        )
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
    service = MissionService(repo, DailyReadingRepository(repo.session), today_fn=lambda: TODAY)
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


# --- summary 가 편성 행에서 빈 날을 가른다 (sqlite) --------------------------------


def _reading(reading_date: date, review_status: str = "reviewed") -> DailyReading:
    return DailyReading(
        reading_date=reading_date,
        title="참사랑의 근본",
        body="본문",
        speaker="참아버님",
        work_title="천성경",
        authority_grade="O1",
        review_status=review_status,
    )


async def _seed(repo: MissionLogRepository, user_id: uuid.UUID, reads: set[date], readings: list[DailyReading]):
    for day in sorted(reads):
        await repo.create(MissionLog(user_id=user_id, mission_date=day, kind="read"))
    readings_repo = DailyReadingRepository(repo.session)
    for reading in readings:
        await readings_repo.create(reading)
    return readings_repo


@pytest.mark.asyncio
async def test_summary_withdrawn_day_counts_as_unscheduled(repo: MissionLogRepository):
    user_id = uuid.uuid4()
    # -3 은 행이 없고 -2 는 철회 → 둘 다 빈 날. -4·-1 은 편성 있음·완료
    readings_repo = await _seed(
        repo, user_id, _days(-1, -4), [_reading(_day(-4)), _reading(_day(-2), "withdrawn"), _reading(_day(-1))]
    )
    summary = await MissionService(repo, readings_repo, today_fn=lambda: TODAY).summary(user_id)
    assert (summary.streak_days, summary.best_streak_days, summary.total_days) == (2, 2, 2)

    # 철회를 되돌리면(편성 있음·미완료) 끊긴다
    withdrawn = await readings_repo.get_by_date(_day(-2))
    assert withdrawn is not None
    withdrawn.review_status = "reviewed"
    await readings_repo.save(withdrawn)
    summary = await MissionService(repo, readings_repo, today_fn=lambda: TODAY).summary(user_id)
    assert (summary.streak_days, summary.best_streak_days) == (1, 1)


@pytest.mark.asyncio
async def test_summary_period_before_any_schedule(repo: MissionLogRepository):
    """편성이 한 번도 없던 시기의 읽기는 서로 이어지고, 편성이 시작된 뒤 빠진 날에서 끊긴다."""
    user_id = uuid.uuid4()
    readings = [_reading(_day(offset)) for offset in range(-10, 0)]  # -10~-1 편성, 그 전은 없음
    readings_repo = await _seed(repo, user_id, _days(-20, -18, -15, -2, -1), readings)
    summary = await MissionService(repo, readings_repo, today_fn=lambda: TODAY).summary(user_id)
    assert (summary.streak_days, summary.best_streak_days) == (2, 3)


@pytest.mark.asyncio
async def test_summary_reads_schedule_once_for_streak_span():
    """편성 날짜는 첫 완료일~오늘을 한 번에 읽는다. 완료가 없으면 읽지 않는다."""

    class _Logs:
        def __init__(self, dates: list[date]) -> None:
            self.dates = dates

        async def kinds_on(self, user_id, mission_date):
            return set()

        async def list_dates(self, user_id, kind):
            return self.dates

    class _Readings:
        def __init__(self) -> None:
            self.calls: list[tuple[date, date]] = []

        async def list_scheduled_dates(self, start, end):
            self.calls.append((start, end))
            return set()

    readings = _Readings()
    summary = await MissionService(_Logs([]), readings, today_fn=lambda: TODAY).summary(uuid.uuid4())  # type: ignore[arg-type]
    assert summary.streak_days == 0 and readings.calls == []

    summary = await MissionService(
        _Logs([_day(-30), _day(-2)]), readings, today_fn=lambda: TODAY  # type: ignore[arg-type]
    ).summary(uuid.uuid4())
    assert readings.calls == [(_day(-30), TODAY)]
    assert (summary.streak_days, summary.best_streak_days) == (2, 2)  # 사이 날이 모두 편성 없음


@pytest.mark.asyncio
async def test_summary_today_follows_kst_boundary(repo: MissionLogRepository):
    """UTC 15:00 에 KST 날짜가 바뀐다. 9/28 편성 있음·미완료, 9/29 편성 없음, 9/27 완료."""
    user_id = uuid.uuid4()
    readings = [_reading(date(2026, 9, 27)), _reading(date(2026, 9, 28))]
    readings_repo = await _seed(repo, user_id, {date(2026, 9, 27)}, readings)

    def at(moment: datetime) -> MissionService:
        return MissionService(repo, readings_repo, today_fn=lambda: today_kst(moment))

    # KST 9/28 23:59 — 오늘(9/28)은 아직 안 읽었을 뿐이라 어제(9/27)부터 센다
    assert (await at(datetime(2026, 9, 28, 14, 59, tzinfo=timezone.utc)).summary(user_id)).streak_days == 1
    # KST 9/29 00:00 — 오늘은 편성 없음, 어제(9/28)는 편성 있음·미완료 → 끊긴다
    assert (await at(datetime(2026, 9, 28, 15, 0, tzinfo=timezone.utc)).summary(user_id)).streak_days == 0


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


class _NoSchedule:
    async def list_scheduled_dates(self, start, end):
        return set()


@pytest.fixture
def client():
    user = User(email="a@b.c", password_hash="x", display_name="효진")
    logs = _Logs()
    app.dependency_overrides[get_identity_repository] = lambda: _Users(user)
    app.dependency_overrides[get_mission_repository] = lambda: logs
    app.dependency_overrides[get_hoondok_repository] = lambda: _NoSchedule()
    try:
        c = TestClient(app)
        c.hoondok_user = user  # type: ignore[attr-defined]
        yield c
    finally:
        app.dependency_overrides.pop(get_identity_repository, None)
        app.dependency_overrides.pop(get_mission_repository, None)
        app.dependency_overrides.pop(get_hoondok_repository, None)


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
