"""훈독 API-HD-029 GET /hoondok/today/together — 익명 완료자 수 · 10명 기준 숨김 · kind/날짜/탈퇴 제외 · KST 경계 · 캐시."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

from app.core.common.clock import today_kst
from app.main import app
from app.modules.hoondok.dependencies import get_together_service
from app.modules.hoondok.models import MissionLog
from app.modules.hoondok.repository import MissionLogRepository
from app.modules.hoondok.schemas import TogetherTodayResponse
from app.modules.hoondok.together_service import TogetherService, clear_together_cache
from app.modules.identity.models import User

TODAY = date(2026, 9, 23)
MIN_COUNT = 10


@pytest.fixture
async def repo():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[User.__table__, MissionLog.__table__])
    session = AsyncSession(engine, expire_on_commit=False)
    clear_together_cache()
    try:
        yield MissionLogRepository(session)
    finally:
        clear_together_cache()
        await session.close()
        await engine.dispose()


async def _user(repo: MissionLogRepository, *, deleted: bool = False) -> uuid.UUID:
    user = User(
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
        display_name="식구",
        deleted_at=datetime(2026, 9, 1) if deleted else None,
    )
    repo.session.add(user)
    await repo.session.commit()
    return user.id


async def _done(repo: MissionLogRepository, user_id: uuid.UUID, *, day: date = TODAY, kind: str = "read") -> None:
    await repo.create(MissionLog(user_id=user_id, mission_date=day, kind=kind))


async def _users_done(repo: MissionLogRepository, n: int) -> None:
    for _ in range(n):
        await _done(repo, await _user(repo))


def _service(repo: MissionLogRepository, **kwargs) -> TogetherService:
    kwargs.setdefault("cache_seconds", 0)
    return TogetherService(repo, min_count=MIN_COUNT, today_fn=lambda: TODAY, **kwargs)


# --- 기준 인원 -----------------------------------------------------------


@pytest.mark.asyncio
async def test_zero_is_hidden(repo: MissionLogRepository):
    res = await _service(repo).get_today()
    assert (res.date, res.count, res.is_shown, res.threshold) == (TODAY, None, False, MIN_COUNT)


@pytest.mark.asyncio
async def test_nine_is_hidden_and_count_not_sent(repo: MissionLogRepository):
    await _users_done(repo, 9)
    assert await repo.count_users_on(TODAY, "read") == 9
    res = await _service(repo).get_today()
    assert res.count is None and res.is_shown is False
    assert "count" in res.model_dump() and res.model_dump()["count"] is None


@pytest.mark.asyncio
async def test_ten_is_shown(repo: MissionLogRepository):
    await _users_done(repo, 10)
    res = await _service(repo).get_today()
    assert res.count == 10 and res.is_shown is True


# --- 집계 규칙 -----------------------------------------------------------


@pytest.mark.asyncio
async def test_same_user_counts_once(repo: MissionLogRepository):
    """unique 제약이 있어도 DISTINCT 로 센다 — 한 사용자가 read·pray·study 를 다 해도 read 1명."""
    uid = await _user(repo)
    for kind in ("read", "pray", "study"):
        await _done(repo, uid, kind=kind)
    assert await repo.count_users_on(TODAY, "read") == 1


@pytest.mark.asyncio
async def test_other_kinds_excluded(repo: MissionLogRepository):
    await _done(repo, await _user(repo), kind="pray")
    await _done(repo, await _user(repo), kind="study")
    await _done(repo, await _user(repo), kind="read")
    assert await repo.count_users_on(TODAY, "read") == 1


@pytest.mark.asyncio
async def test_yesterday_excluded(repo: MissionLogRepository):
    await _done(repo, await _user(repo), day=TODAY - timedelta(days=1))
    await _done(repo, await _user(repo), day=TODAY + timedelta(days=1))
    await _done(repo, await _user(repo))
    assert await repo.count_users_on(TODAY, "read") == 1


@pytest.mark.asyncio
async def test_deleted_users_excluded(repo: MissionLogRepository):
    await _users_done(repo, 9)
    await _done(repo, await _user(repo, deleted=True))
    res = await _service(repo).get_today()
    assert res.is_shown is False and res.count is None
    assert await repo.count_users_on(TODAY, "read") == 9


# --- KST 날짜 경계 (UTC 15:00 = KST 자정) ---------------------------------


@pytest.mark.asyncio
async def test_kst_boundary_at_utc_15(repo: MissionLogRepository):
    before = datetime(2026, 9, 23, 14, 59, 59, tzinfo=timezone.utc)  # KST 9/23 23:59:59
    after = datetime(2026, 9, 23, 15, 0, 0, tzinfo=timezone.utc)  # KST 9/24 00:00:00
    assert today_kst(before) == date(2026, 9, 23)
    assert today_kst(after) == date(2026, 9, 24)

    for _ in range(10):
        await _done(repo, await _user(repo), day=date(2026, 9, 23))

    def at(moment: datetime) -> TogetherService:
        return TogetherService(repo, min_count=MIN_COUNT, cache_seconds=0, today_fn=lambda: today_kst(moment))

    res_before = await at(before).get_today()
    res_after = await at(after).get_today()
    assert (res_before.date, res_before.count) == (date(2026, 9, 23), 10)
    assert (res_after.date, res_after.count, res_after.is_shown) == (date(2026, 9, 24), None, False)


# --- 캐시 ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_holds_value_until_ttl(repo: MissionLogRepository):
    now = [1000.0]
    service = _service(repo, cache_seconds=60, clock=lambda: now[0])
    await _users_done(repo, 10)
    assert (await service.get_today()).count == 10

    await _users_done(repo, 1)
    now[0] += 59
    assert (await service.get_today()).count == 10  # 60초 안에는 캐시값
    now[0] += 2
    assert (await service.get_today()).count == 11  # 만료 뒤 다시 집계


@pytest.mark.asyncio
async def test_cache_disabled_reads_every_time(repo: MissionLogRepository):
    service = _service(repo, cache_seconds=0)
    await _users_done(repo, 10)
    assert (await service.get_today()).count == 10
    await _users_done(repo, 1)
    assert (await service.get_today()).count == 11


# --- router --------------------------------------------------------------


class _FixedService:
    def __init__(self, count: int) -> None:
        self.count = count

    async def get_today(self):
        is_shown = self.count >= MIN_COUNT
        return TogetherTodayResponse(
            date=TODAY, count=self.count if is_shown else None, is_shown=is_shown, threshold=MIN_COUNT
        )


@pytest.mark.parametrize(
    ("count", "expected"),
    [
        (1284, {"date": "2026-09-23", "count": 1284, "is_shown": True, "threshold": 10}),
        (3, {"date": "2026-09-23", "count": None, "is_shown": False, "threshold": 10}),
    ],
)
def test_router_public_no_auth(count: int, expected: dict):
    app.dependency_overrides[get_together_service] = lambda: _FixedService(count)
    try:
        res = TestClient(app).get("/hoondok/today/together")  # 쿠키 없이도 200
    finally:
        app.dependency_overrides.pop(get_together_service, None)
    assert res.status_code == 200
    assert res.json() == expected
