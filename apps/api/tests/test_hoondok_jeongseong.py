"""훈독 API-HD-009 정성 기간 — 진행률 순수 함수 · 부분 unique(sqlite_where) · 서비스 409/자동 completed ·
마무리 카드 last_ended(7일·최근이 abandoned 면 없음·KST 자정) · 나의 각오(trim·50자·본인 응답만) · 라우터 401/403/422/201/409 · DELETE 204/404 · admin_token 거부."""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.core.common.clock import today_kst
from app.main import app
from app.modules.admin.auth import create_access_token
from app.modules.hoondok.dependencies import get_jeongseong_repository, get_mission_repository
from app.modules.hoondok.jeongseong import compute_progress
from app.modules.hoondok.models import ClientErrorEvent, JeongseongPeriod, JeongseongReading, MissionLog
from app.modules.hoondok.repository import JeongseongRepository, MissionLogRepository
from app.modules.hoondok.schemas import JeongseongCreate
from app.modules.hoondok.service import JeongseongService
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.schemas import SignupRequest
from app.modules.identity.service import IdentityService

TODAY = date(2026, 9, 19)
XHR = {"X-Requested-With": "XMLHttpRequest"}
PATH = "/hoondok/me/jeongseong"


def _days(*offsets: int) -> set[date]:
    return {TODAY + timedelta(days=o) for o in offsets}


# --- compute_progress 순수 함수 -------------------------------------------------


def test_progress_upcoming_active_completed_states():
    # upcoming: 내일 시작 7일 — 아직 아무것도 세지 않고 remaining 은 end_on 까지 전부
    p = compute_progress(TODAY + timedelta(days=1), 7, _days(0, -1), TODAY)
    assert p.state == "upcoming" and p.done_days == 0 and p.missed_days == 0
    assert p.end_on == TODAY + timedelta(days=7) and p.remaining_days == 7 and p.percent == 0

    # active: 오늘 시작 7일, 오늘 읽음
    p = compute_progress(TODAY, 7, _days(0), TODAY)
    assert p.state == "active" and p.done_days == 1 and p.missed_days == 0
    assert p.end_on == TODAY + timedelta(days=6) and p.remaining_days == 6 and p.percent == 14

    # completed: 10일 전 시작 7일 → end_on = TODAY-4. 앞 3일만 읽음
    p = compute_progress(TODAY - timedelta(days=10), 7, _days(-10, -9, -8), TODAY)
    assert p.state == "completed" and p.end_on == TODAY - timedelta(days=4)
    assert p.done_days == 3 and p.missed_days == 4 and p.remaining_days == 0 and p.percent == 43


def test_progress_missed_excludes_today_and_clamps_to_end():
    # 3일 전 시작, 어제만 빠짐, 오늘 아직 안 읽음 → missed 1 (오늘은 밀린 날이 아니다)
    p = compute_progress(TODAY - timedelta(days=3), 7, _days(-3, -2), TODAY)
    assert p.state == "active" and p.done_days == 2 and p.missed_days == 1 and p.remaining_days == 3

    # 어제 끝난 7일 기간(TODAY-7 ~ TODAY-1): 기간 밖(오늘·8일 전) 완료는 세지 않고 end_on 에서 클램프
    p = compute_progress(TODAY - timedelta(days=7), 7, _days(0, -1, -2, -8), TODAY)
    assert p.state == "completed" and p.done_days == 2 and p.missed_days == 5 and p.remaining_days == 0

    # 마지막 날(end_on == today)은 아직 active, remaining 0
    p = compute_progress(TODAY - timedelta(days=6), 7, set(), TODAY)
    assert p.state == "active" and p.remaining_days == 0 and p.missed_days == 6

    # percent 는 half-up: 40일 중 1일 = 2.5 → 3 (내장 round 는 2). 21/21 → 100
    assert compute_progress(TODAY, 40, _days(0), TODAY).percent == 3
    assert compute_progress(TODAY - timedelta(days=20), 21, _days(*range(-20, 1)), TODAY).percent == 100


# --- repository · service (aiosqlite) -------------------------------------------


@pytest.fixture
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            # 정성 말씀·오류 기록은 계정 삭제(delete_for_user)가 함께 지우므로 테이블이 있어야 한다
            tables=[
                User.__table__,
                MissionLog.__table__,
                JeongseongPeriod.__table__,
                JeongseongReading.__table__,
                ClientErrorEvent.__table__,
            ],
        )
    session = AsyncSession(engine, expire_on_commit=False)
    try:
        yield session
    finally:
        await session.close()
        await engine.dispose()


def _period(user_id: uuid.UUID, topic: str = "감사", duration_days: int = 7, started_on: date = TODAY) -> JeongseongPeriod:
    return JeongseongPeriod(user_id=user_id, topic=topic, duration_days=duration_days, started_on=started_on)


@pytest.mark.asyncio
async def test_repo_partial_unique_one_active_per_user(session: AsyncSession):
    repo = JeongseongRepository(session)
    user_id = uuid.uuid4()
    first = await repo.create(_period(user_id))
    with pytest.raises(IntegrityError):
        await repo.create(_period(user_id, topic="둘", duration_days=21))
    # 다른 사용자는 각자 active 1건
    await repo.create(_period(uuid.uuid4(), topic="다른"))

    # abandoned 로 바꾸면 새 active 가능 — 비활성(completed·abandoned) 행은 여러 건 공존한다
    first = await repo.get_active(user_id)
    first.status = "abandoned"
    await repo.save(first)
    second = await repo.create(_period(user_id, topic="다시", duration_days=40))
    assert (await repo.get_active(user_id)).id == second.id
    second.status = "completed"
    await repo.save(second)
    third = await repo.create(_period(user_id, topic="셋"))
    assert (await repo.get_active(user_id)).id == third.id


@pytest.mark.asyncio
async def test_service_create_then_409_and_get_current(session: AsyncSession):
    missions = MissionLogRepository(session)
    service = JeongseongService(JeongseongRepository(session), missions, today_fn=lambda: TODAY)
    user_id = uuid.uuid4()
    assert (await service.get_current(user_id)).period is None

    created = await service.create(
        user_id, JeongseongCreate(topic="  감사  ", duration_days=21, reminder_time=time(6, 0))
    )
    assert created.topic == "감사" and created.started_on == TODAY and created.status == "active"
    assert created.reminder_time == time(6, 0)
    assert created.progress.state == "active" and created.progress.end_on == TODAY + timedelta(days=20)
    assert (created.progress.done_days, created.progress.remaining_days, created.progress.percent) == (0, 20, 0)

    with pytest.raises(HTTPException) as exc:
        await service.create(user_id, JeongseongCreate(topic="둘", duration_days=7))
    assert exc.value.status_code == 409

    # read 완료만 진행률에 반영 (pray 는 무시)
    await missions.create(MissionLog(user_id=user_id, mission_date=TODAY, kind="read"))
    await missions.create(MissionLog(user_id=user_id, mission_date=TODAY, kind="pray"))
    current = (await service.get_current(user_id)).period
    assert current is not None and current.id == created.id
    assert current.progress.done_days == 1 and current.progress.percent == 5 and current.progress.missed_days == 0

    # 시작일 범위: 어제·오늘+31 은 422, 오늘+30 은 허용(upcoming)
    for bad in (TODAY - timedelta(days=1), TODAY + timedelta(days=31)):
        with pytest.raises(HTTPException) as exc:
            await service.create(uuid.uuid4(), JeongseongCreate(topic="x", duration_days=7, started_on=bad))
        assert exc.value.status_code == 422
    upcoming = await service.create(
        uuid.uuid4(), JeongseongCreate(topic="x", duration_days=7, started_on=TODAY + timedelta(days=30))
    )
    assert upcoming.progress.state == "upcoming" and upcoming.status == "active"


@pytest.mark.asyncio
async def test_service_get_marks_completed_after_end_on(session: AsyncSession):
    repo = JeongseongRepository(session)
    service = JeongseongService(repo, MissionLogRepository(session), today_fn=lambda: TODAY)
    user_id = uuid.uuid4()
    stale = await repo.create(_period(user_id, topic="지난", started_on=TODAY - timedelta(days=7)))  # end_on = TODAY-1

    assert (await service.get_current(user_id)).period is None
    await session.refresh(stale)
    assert stale.status == "completed" and stale.ended_at is not None and stale.updated_at >= stale.created_at
    assert await repo.get_active(user_id) is None

    # 정리된 뒤엔 새 기간을 시작할 수 있다 (409 아님)
    fresh = await service.create(user_id, JeongseongCreate(topic="새", duration_days=7))
    assert fresh.status == "active" and fresh.id != stale.id

    # 마지막 날(end_on == today)은 아직 active 로 남는다
    last_day_user = uuid.uuid4()
    await repo.create(_period(last_day_user, topic="마지막날", started_on=TODAY - timedelta(days=6)))
    current = (await service.get_current(last_day_user)).period
    assert current is not None and current.progress.state == "active" and current.progress.remaining_days == 0


# --- 마무리 카드 last_ended (aiosqlite) -------------------------------------------


def _service(session: AsyncSession, today_fn=lambda: TODAY) -> JeongseongService:
    return JeongseongService(JeongseongRepository(session), MissionLogRepository(session), today_fn=today_fn)


def _at(day_offset: int) -> datetime:
    """TODAY + day_offset 날짜의 정오(UTC, naive) — ended_at 용."""
    return datetime.combine(TODAY + timedelta(days=day_offset), time(12, 0))


async def _ended(
    repo: JeongseongRepository,
    user_id: uuid.UUID,
    end_offset: int,
    *,
    status: str = "completed",
    topic: str = "감사",
    resolution: str | None = None,
    duration_days: int = 7,
    ended_offset: int | None = None,
) -> JeongseongPeriod:
    """end_on = TODAY + end_offset 인 끝난 기간. ended_at 은 기본으로 end_on 다음 날(읽는 시점 정리)."""
    period = _period(user_id, topic, duration_days, TODAY + timedelta(days=end_offset - (duration_days - 1)))
    period.status = status
    period.resolution = resolution
    period.ended_at = _at(end_offset + 1 if ended_offset is None else ended_offset)
    return await repo.create(period)


@pytest.mark.asyncio
async def test_last_ended_shows_completed_within_seven_days(session: AsyncSession):
    repo = JeongseongRepository(session)
    service = _service(session)
    for offset, shown in ((-1, True), (-7, True), (-8, False)):
        user_id = uuid.uuid4()
        period = await _ended(repo, user_id, offset, duration_days=21, resolution="날마다 감사")
        current = await service.get_current(user_id)
        assert current.period is None
        if shown:
            assert current.last_ended is not None, offset
            # 완료한 날 수·진행률은 없다 — 빠진 날을 계산할 수 없게 한다
            assert current.last_ended.model_dump() == {
                "id": period.id,
                "topic": "감사",
                "resolution": "날마다 감사",
                "duration_days": 21,
                "started_on": TODAY + timedelta(days=offset - 20),
                "end_on": TODAY + timedelta(days=offset),
            }
        else:
            assert current.last_ended is None, offset

    # 어제 끝난 active 기간 — 이 GET 이 completed 로 정리하고 같은 응답에서 마무리 카드를 준다
    user_id = uuid.uuid4()
    stale = await repo.create(_period(user_id, topic="지난", started_on=TODAY - timedelta(days=7)))
    current = await service.get_current(user_id)
    assert current.period is None and current.last_ended is not None and current.last_ended.id == stale.id


@pytest.mark.asyncio
async def test_last_ended_ignores_abandoned(session: AsyncSession):
    repo = JeongseongRepository(session)
    service = _service(session)
    user_id = uuid.uuid4()
    await _ended(repo, user_id, -1, status="abandoned")
    assert (await service.get_current(user_id)).last_ended is None

    # DELETE(그만두기)로 끝낸 기간도 마무리 카드가 없다
    other = uuid.uuid4()
    await service.create(other, JeongseongCreate(topic="감사", duration_days=7))
    await service.abandon(other)
    assert (await service.get_current(other)).last_ended is None


@pytest.mark.asyncio
async def test_last_ended_null_when_latest_ended_is_abandoned(session: AsyncSession):
    """A 를 마치고 B 를 시작했다 그만두면, 가장 최근에 끝난 기간은 B(abandoned) — A 의 마무리 카드를 다시 띄우지 않는다."""
    repo = JeongseongRepository(session)
    service = _service(session)
    user_id = uuid.uuid4()
    await _ended(repo, user_id, -5, topic="A")  # ended_at = 4일 전
    await _ended(repo, user_id, -1, status="abandoned", topic="B", ended_offset=-1)
    assert (await service.get_current(user_id)).last_ended is None

    # 거꾸로 그만둔 뒤 새로 마친 기간은 카드가 있다
    other = uuid.uuid4()
    await _ended(repo, other, -10, status="abandoned", ended_offset=-10)
    done = await _ended(repo, other, -2, topic="C")
    ended = (await service.get_current(other)).last_ended
    assert ended is not None and ended.id == done.id

    # 예정 기간을 그만두면 시작일이 뒤 기간보다 늦을 수 있다 — 시작일이 아니라 끝난 순서로 고른다
    third = uuid.uuid4()
    await _ended(repo, third, 20, status="abandoned", ended_offset=-9)  # 시작일 = TODAY+14, 9일 전에 그만둠
    later = await _ended(repo, third, -1, topic="D")  # 그 뒤에 시작해 어제 마침
    ended = (await service.get_current(third)).last_ended
    assert ended is not None and ended.id == later.id


@pytest.mark.asyncio
async def test_last_ended_null_while_period_active_or_upcoming(session: AsyncSession):
    repo = JeongseongRepository(session)
    service = _service(session)
    for started_on in (TODAY, TODAY + timedelta(days=3)):  # 진행 중 · 예정
        user_id = uuid.uuid4()
        await _ended(repo, user_id, -1)
        await service.create(user_id, JeongseongCreate(topic="새", duration_days=7, started_on=started_on))
        current = await service.get_current(user_id)
        assert current.period is not None and current.last_ended is None


@pytest.mark.asyncio
async def test_last_ended_picks_latest_completed(session: AsyncSession):
    repo = JeongseongRepository(session)
    user_id = uuid.uuid4()
    # 늦게 끝난 기간을 먼저 넣는다 — 입력 순서가 아니라 끝난 순서로 고른다
    latest = await _ended(repo, user_id, -1, topic="나중")
    await _ended(repo, user_id, -8, topic="먼저")
    ended = (await _service(session).get_current(user_id)).last_ended
    assert ended is not None and ended.id == latest.id and ended.topic == "나중"


@pytest.mark.asyncio
async def test_last_ended_gone_after_account_delete(session: AsyncSession):
    identity = IdentityService(UserRepository(session))
    me = await identity.signup(SignupRequest(email="me@example.com", password="password1", display_name="효진"))
    repo = JeongseongRepository(session)
    await _ended(repo, me.id, -1, resolution="날마다 감사")
    service = _service(session)
    assert (await service.get_current(me.id)).last_ended is not None

    await identity.delete_account(me, purgers=[repo])
    assert (await service.get_current(me.id)).last_ended is None
    # 각오는 기간 행에 있으므로 기간과 함께 지워진다
    assert (await session.execute(select(JeongseongPeriod).where(JeongseongPeriod.user_id == me.id))).first() is None


@pytest.mark.asyncio
async def test_last_ended_window_follows_kst_midnight(session: AsyncSession):
    """end_on 이 7일 전이면 그날 밤 23:59(KST)까지 보이고 KST 자정(UTC 15:00)부터 사라진다."""
    repo = JeongseongRepository(session)
    user_id = uuid.uuid4()
    await _ended(repo, user_id, -7)  # end_on = 9/12, TODAY = 9/19

    def at(hour: int, minute: int):
        return lambda: today_kst(datetime(2026, 9, 19, hour, minute, tzinfo=timezone.utc))

    assert (await _service(session, at(14, 59)).get_current(user_id)).last_ended is not None  # KST 9/19 23:59
    assert (await _service(session, at(15, 0)).get_current(user_id)).last_ended is None  # KST 9/20 00:00


# --- 나의 각오 resolution ---------------------------------------------------------


@pytest.mark.asyncio
async def test_resolution_trimmed_blank_is_null_and_returned_to_owner(session: AsyncSession):
    service = _service(session)
    created = await service.create(
        uuid.uuid4(), JeongseongCreate(topic="감사", duration_days=7, resolution="  날마다 감사  ")
    )
    assert created.resolution == "날마다 감사"
    for blank in (None, "", "   "):
        user_id = uuid.uuid4()
        period = await service.create(user_id, JeongseongCreate(topic="감사", duration_days=7, resolution=blank))
        assert period.resolution is None
        assert (await service.get_current(user_id)).period.resolution is None
    # 50자는 허용, 공백을 지운 뒤 51자면 422(Pydantic)
    assert JeongseongCreate(topic="x", duration_days=7, resolution=" " + "가" * 50 + " ").resolution == "가" * 50
    with pytest.raises(ValidationError):
        JeongseongCreate(topic="x", duration_days=7, resolution="가" * 51)


def test_resolution_only_in_own_jeongseong_schemas():
    """각오는 본인 정성(API-HD-009) 스키마에만 있다 — 모임·가족·관리자 응답 어디에도 없다."""
    schema = app.openapi()
    with_resolution = {
        name
        for name, body in schema["components"]["schemas"].items()
        if "resolution" in body.get("properties", {})
    }
    assert with_resolution == {"JeongseongCreate", "JeongseongPeriodResponse", "JeongseongLastEnded"}
    refs = {f"#/components/schemas/{name}" for name in with_resolution | {"JeongseongCurrentResponse"}}
    paths = {
        path
        for path, ops in schema["paths"].items()
        if any(ref in json.dumps(ops) for ref in refs)
    }
    assert paths == {PATH}


# --- router (인메모리 fake) -------------------------------------------------------


class _Users:
    def __init__(self, user: User) -> None:
        self.user = user

    async def get_by_id(self, user_id):
        return self.user if user_id == self.user.id else None


class _Logs:
    def __init__(self) -> None:
        self.rows: set[tuple] = set()
        self.session = MagicMock()

    async def list_dates(self, user_id, kind):
        return sorted(d for u, d, k in self.rows if u == user_id and k == kind)


class _Periods:
    def __init__(self) -> None:
        self.rows: dict[uuid.UUID, JeongseongPeriod] = {}
        self.session = MagicMock()

    async def get_active(self, user_id):
        return next((p for p in self.rows.values() if p.user_id == user_id and p.status == "active"), None)

    async def get_last_ended(self, user_id):
        ended = [p for p in self.rows.values() if p.user_id == user_id and p.status != "active"]
        return max(ended, key=lambda p: p.ended_at, default=None)

    async def create(self, period: JeongseongPeriod) -> JeongseongPeriod:
        if await self.get_active(period.user_id) is not None:
            raise IntegrityError("dup", None, Exception("uq_jeongseong_periods_user_active"))
        self.rows[period.id] = period
        return period

    async def save(self, period: JeongseongPeriod) -> JeongseongPeriod:
        self.rows[period.id] = period
        return period


class _RacingPeriods(_Periods):
    """동시 생성 경쟁 — 선조회는 비어 있는데 INSERT 순간 부분 unique 가 잡는다."""

    async def get_active(self, user_id):
        return None

    async def create(self, period: JeongseongPeriod) -> JeongseongPeriod:
        raise IntegrityError("dup", None, Exception("uq_jeongseong_periods_user_active"))


@pytest.fixture
def client():
    user = User(email="a@b.c", password_hash="x", display_name="효진")
    periods = _Periods()
    app.dependency_overrides[get_identity_repository] = lambda: _Users(user)
    app.dependency_overrides[get_mission_repository] = lambda: _Logs()
    app.dependency_overrides[get_jeongseong_repository] = lambda: periods
    try:
        c = TestClient(app)
        c.hoondok_user = user  # type: ignore[attr-defined]
        c.periods = periods  # type: ignore[attr-defined]
        yield c
    finally:
        for dep in (get_identity_repository, get_mission_repository, get_jeongseong_repository):
            app.dependency_overrides.pop(dep, None)


def test_router_401_403_422_201_409_and_get_null(client: TestClient):
    body = {"topic": "감사", "duration_days": 7}
    assert client.get(PATH).status_code == 401
    assert client.post(PATH, json=body, headers=XHR).status_code == 401

    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(client.hoondok_user))
    assert client.post(PATH, json=body).status_code == 403  # CSRF 헤더 없음
    assert client.get(PATH).json() == {"period": None, "last_ended": None}

    for bad in (
        {**body, "duration_days": 10},  # Literal 밖
        {**body, "topic": "   "},  # strip 후 빈 주제
        {**body, "topic": "가" * 41},
        {**body, "started_on": "2020-01-01"},  # 오늘~+30 밖
        {**body, "reminder_time": "25:00"},
        {**body, "resolution": "가" * 51},  # 각오 50자 초과
    ):
        assert client.post(PATH, json=bad, headers=XHR).status_code == 422, bad

    created = client.post(PATH, json={**body, "reminder_time": "06:30"}, headers=XHR)
    assert created.status_code == 201, created.text
    period = created.json()
    assert set(period) == {
        "id", "topic", "resolution", "duration_days", "started_on", "reminder_time", "status", "progress"
    }
    assert period["resolution"] is None  # 안 보내면 각오 없음
    assert period["status"] == "active" and period["reminder_time"] == "06:30:00" and period["duration_days"] == 7
    assert set(period["progress"]) == {"end_on", "done_days", "missed_days", "remaining_days", "percent", "state"}
    assert period["progress"]["state"] == "active" and period["progress"]["percent"] == 0

    assert client.post(PATH, json=body, headers=XHR).status_code == 409
    current = client.get(PATH)
    assert current.status_code == 200 and current.json()["period"]["id"] == period["id"]


def test_router_create_race_integrity_error_falls_back_to_409(client: TestClient):
    """선조회를 통과한 뒤 부분 unique 가 잡아도 선조회 409 와 같은 응답을 준다 — 클라이언트는 경쟁을 구분할 필요가 없다."""
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(client.hoondok_user))
    body = {"topic": "감사", "duration_days": 7}
    assert client.post(PATH, json=body, headers=XHR).status_code == 201
    precheck = client.post(PATH, json=body, headers=XHR)  # 선조회 409 — 비교 기준
    assert precheck.status_code == 409

    app.dependency_overrides[get_jeongseong_repository] = lambda: _RacingPeriods()
    raced = client.post(PATH, json=body, headers=XHR)
    assert raced.status_code == 409, raced.text
    assert raced.json() == precheck.json() == {"detail": "이미 진행 중인 정성 기간이 있어요"}


def test_router_delete_abandons_204_then_404(client: TestClient):
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(client.hoondok_user))
    assert client.delete(PATH).status_code == 403  # CSRF
    assert client.delete(PATH, headers=XHR).status_code == 404

    created = client.post(PATH, json={"topic": "감사", "duration_days": 40}, headers=XHR)
    assert created.status_code == 201
    assert client.delete(PATH, headers=XHR).status_code == 204

    row = client.periods.rows[uuid.UUID(created.json()["id"])]
    assert row.status == "abandoned" and row.ended_at is not None
    assert client.get(PATH).json() == {"period": None, "last_ended": None}
    assert client.delete(PATH, headers=XHR).status_code == 404
    # 그만둔 뒤 새 기간 시작 가능
    assert client.post(PATH, json={"topic": "다시", "duration_days": 7}, headers=XHR).status_code == 201


def test_router_resolution_and_last_ended_without_day_counts(client: TestClient):
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(client.hoondok_user))
    created = client.post(
        PATH, json={"topic": "감사", "duration_days": 7, "resolution": " 날마다 감사 "}, headers=XHR
    ).json()
    assert created["resolution"] == "날마다 감사"
    assert client.get(PATH).json()["period"]["resolution"] == "날마다 감사"
    today = today_kst()
    client.periods.rows[uuid.UUID(created["id"])].started_on = today - timedelta(days=7)  # end_on = 어제

    body = client.get(PATH).json()
    assert body["period"] is None
    # 완료한 날 수·진행률은 보내지 않는다 — 빠진 날을 계산할 수 없게 한다
    assert body["last_ended"] == {
        "id": created["id"],
        "topic": "감사",
        "resolution": "날마다 감사",
        "duration_days": 7,
        "started_on": (today - timedelta(days=7)).isoformat(),
        "end_on": (today - timedelta(days=1)).isoformat(),
    }


def test_router_rejects_admin_token(client: TestClient):
    admin = create_access_token({"sub": str(client.hoondok_user.id), "role": "admin", "email": "admin@test.com"})
    client.cookies.set("admin_token", admin)
    assert client.get(PATH).status_code == 401
    assert client.post(PATH, json={"topic": "x", "duration_days": 7}, headers=XHR).status_code == 401
    assert client.delete(PATH, headers=XHR).status_code == 401
    # 훈독 쿠키 자리에 admin 토큰을 넣어도 aud 가 없어 거부
    client.cookies.set(COOKIE_NAME, admin)
    assert client.get(PATH).status_code == 401
