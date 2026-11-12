"""7일 정성 (읽기 정성 1a) — 빈 날(gap 0/1/2/3) · 이번 주 점 · 끝나는 날 지남(자동 전환 없음) · 마지막 장 → completed ·
하루 한 장 409 · 같은 장 재요청 200 · 순서 밖 409 · read 미션 ON CONFLICT · 정성 기간과 상호 배제(양방향) ·
권리 닫힘 403/withdrawn · 본문 display_text · 마침표 행동 · 계정 삭제 행 0 · 플래그 OFF 404 · note 는 본인 응답에만 · 시드."""

from __future__ import annotations

import dataclasses
import json
import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, func, select

import app.modules.hoondok.dependencies as hoondok_deps
from app.core.common.database import get_async_session
from app.core.config import settings
from app.main import app
from app.modules.hoondok.dependencies import get_today_fn
from app.modules.hoondok.exceptions import PathError
from app.modules.hoondok.models import (
    ClientErrorEvent,
    ContentRight,
    JeongseongPeriod,
    JeongseongReading,
    MissionLog,
    PathRun,
    PathStepCompletion,
    ReadingPath,
    ReadingPathStep,
    VolumeSection,
)
from app.modules.hoondok.paths_repository import PathRepository
from app.modules.hoondok.paths_schemas import PathRunFinishRequest, PathRunStart, PathStepCompleteRequest
from app.modules.hoondok.paths_service import PathService, gap_days, week_read_dates
from app.modules.hoondok.repository import JeongseongRepository, MissionLogRepository
from app.modules.hoondok.schemas import JeongseongCreate
from app.modules.hoondok.service import JeongseongService
from app.modules.identity.dependencies import COOKIE_NAME
from app.modules.identity.models import User, UserIdentity
from app.modules.identity.repository import UserRepository
from app.modules.identity.service import IdentityService
from app.modules.qdrant import QdrantPoint
from scripts.seed_reading_paths import Chunk, SeedError, build_steps, seed_paths

DAY = date(2026, 11, 5)  # 목요일
VOLUME = "천성경.pdf"
XHR = {"X-Requested-With": "XMLHttpRequest"}
TABLES = [
    User.__table__,
    UserIdentity.__table__,
    MissionLog.__table__,
    JeongseongPeriod.__table__,
    JeongseongReading.__table__,
    ClientErrorEvent.__table__,
    ContentRight.__table__,
    VolumeSection.__table__,
    ReadingPath.__table__,
    ReadingPathStep.__table__,
    PathRun.__table__,
    PathStepCompletion.__table__,
]


def _chunk_id(index: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"paths-test:{index}"))


class FakeQdrant:
    """scroll 만 흉내 낸다 — volume 일치 + chunk_index 범위 필터."""

    def __init__(self, count: int = 60) -> None:
        self.points = [
            QdrantPoint(
                id=_chunk_id(i),
                score=0.0,
                payload={"volume": VOLUME, "chunk_index": i, "text": f"말씀 {i}번째 단락입니다.", "source": ["M"]},
            )
            for i in range(count)
        ]

    async def scroll(self, collection_name, *, scroll_filter=None, limit=1000, with_vectors=False, **_):
        must = (scroll_filter or {}).get("must", [])
        volume = next(c["match"]["value"] for c in must if c["key"] == "volume")
        rng = next(c["range"] for c in must if c["key"] == "chunk_index")

        def ok(i: int) -> bool:
            return (
                i >= rng.get("gte", -1)
                and i <= rng.get("lte", 10**9)
                and i < rng.get("lt", 10**9)
            )

        hits = [p for p in self.points if p.payload["volume"] == volume and ok(p.payload["chunk_index"])]
        return hits[:limit], None


@pytest.fixture
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=TABLES)
    session = AsyncSession(engine, expire_on_commit=False)
    try:
        yield session
    finally:
        await session.close()
        await engine.dispose()


async def _user(session: AsyncSession, email: str = "me@example.com") -> User:
    user = User(email=email, password_hash="x", display_name="효진")
    session.add(user)
    await session.commit()
    return user


async def _path(
    session: AsyncSession,
    slug: str = "cs7",
    days: int = 7,
    *,
    full_text: bool = True,
    jeongseong: bool = True,
    created_by: uuid.UUID | None = None,
) -> ReadingPath:
    """하루 두 청크(2d-2 ~ 2d-1)씩 7분 단계만 있는 발행 정성 + 권리."""
    if (await session.execute(select(ContentRight).where(ContentRight.volume == VOLUME))).first() is None:
        session.add(
            ContentRight(
                volume=VOLUME,
                status="allowed",
                scope_search=True,
                scope_full_text=full_text,
                scope_jeongseong=jeongseong,
                work_title="천성경",
            )
        )
    path = ReadingPath(
        slug=slug, title="천성경 7일 정성", book="천성경", duration_days=days, status="published", created_by=created_by
    )
    session.add(path)
    await session.flush()
    for d in range(1, days + 1):
        session.add(
            ReadingPathStep(
                path_id=path.id,
                path_version=1,
                minutes_tier=7,
                day_index=d,
                volume=VOLUME,
                start_chunk_index=2 * d - 2,
                end_chunk_index=2 * d - 1,
                start_chunk_id=_chunk_id(2 * d - 2),
                end_chunk_id=_chunk_id(2 * d - 1),
                title=f"1편 {d}장",
                estimated_minutes=7,
            )
        )
    await session.commit()
    return path


def _service(session: AsyncSession, today: date = DAY, client=None) -> PathService:
    today_fn = lambda: today  # noqa: E731
    jeongseong = JeongseongService(
        JeongseongRepository(session), MissionLogRepository(session), today_fn=today_fn, path_runs=PathRepository(session)
    )
    return PathService(
        PathRepository(session), MissionLogRepository(session), jeongseong, client or FakeQdrant(), today_fn=today_fn
    )


async def _complete(session: AsyncSession, user: User, day_index: int, on: date, note: str | None = None):
    return await _service(session, on).complete(user.id, day_index, PathStepCompleteRequest(note=note))


async def _codes(coro) -> str:
    with pytest.raises(PathError) as exc:
        await coro
    return exc.value.error_code


# --- 순수 계산 -------------------------------------------------------------------


def test_gap_days_counts_empty_days_since_last_read():
    start = DAY - timedelta(days=10)
    assert gap_days(set(), DAY, DAY) == 0  # 오늘 시작, 아직 안 읽음
    assert gap_days(set(), DAY - timedelta(days=1), DAY) == 1  # 어제 시작하고 한 번도 안 읽음
    for empty in (0, 1, 2, 3):
        last = DAY - timedelta(days=empty + 1)
        assert gap_days({start, last}, start, DAY) == empty
    assert gap_days({DAY}, start, DAY) == 0  # 오늘 읽음


def test_week_read_dates_starts_on_monday():
    monday = date(2026, 11, 2)
    sunday = date(2026, 11, 1)  # 지난주 마지막 날
    dates = {sunday, monday, DAY - timedelta(days=1), DAY + timedelta(days=1)}
    assert week_read_dates(dates, DAY) == [monday, DAY - timedelta(days=1)]
    assert week_read_dates({monday}, monday) == [monday]
    # 일요일은 그 주(월요일 시작)의 마지막 날이다
    next_sunday = date(2026, 11, 8)
    assert week_read_dates({monday, next_sunday}, next_sunday) == [monday, next_sunday]


# --- 서비스 (aiosqlite) ------------------------------------------------------------


async def test_start_and_daily_rhythm_gap_and_order(session: AsyncSession):
    user = await _user(session)
    await _path(session)
    started = (await _service(session).start(user.id, PathRunStart(slug="cs7", minutes_tier=7))).run
    assert started is not None
    assert (started.status, started.next_step, started.done_steps, started.total_steps) == ("active", 1, 0, 7)
    assert (started.day_no, started.gap_days, started.read_today, started.overdue) == (1, 0, False, False)
    assert started.end_on == DAY + timedelta(days=6) and started.today == DAY
    assert [s.state for s in started.steps][:3] == ["next", "upcoming", "upcoming"]

    done = await _complete(session, user, 1, DAY, note="  감사  ")
    assert done.completion.note == "감사" and done.completion.completed_on == DAY
    assert done.run.next_step == 2 and done.run.read_today and done.run.week_read_dates == [DAY]

    # 같은 날 다른 장 → 409, 같은 장 재요청 → 200 기존 값(한 줄도 그대로)
    assert await _codes(_complete(session, user, 2, DAY)) == "ALREADY_READ_TODAY"
    again = await _complete(session, user, 1, DAY, note="다른 말")
    assert again.completion.note == "감사"
    # 순서 밖 → 409
    assert await _codes(_complete(session, user, 3, DAY + timedelta(days=1))) == "STEP_OUT_OF_ORDER"
    # 읽은 날 뒤 빈 날: 다음 날 0, 사흘 뒤 2, 나흘 뒤 3
    for offset, gap in ((1, 0), (3, 2), (4, 3)):
        current = (await _service(session, DAY + timedelta(days=offset)).get_current(user.id)).run
        assert current is not None and current.gap_days == gap and current.day_no == offset + 1
    # read 미션이 같은 트랜잭션에 들어갔다
    logs = (await session.execute(select(MissionLog).where(MissionLog.user_id == user.id))).scalars().all()
    assert [(m.mission_date, m.kind) for m in logs] == [(DAY, "read")]


async def test_complete_keeps_going_when_daily_read_mission_exists(session: AsyncSession):
    """오늘의 말씀을 먼저 읽어 read 미션이 있어도 장 완료는 성공한다(ON CONFLICT DO NOTHING)."""
    user = await _user(session)
    await _path(session)
    await _service(session).start(user.id, PathRunStart(slug="cs7", minutes_tier=7))
    await MissionLogRepository(session).create(MissionLog(user_id=user.id, mission_date=DAY, kind="read"))
    assert (await _complete(session, user, 1, DAY)).run.done_steps == 1
    count = await session.scalar(select(func.count()).select_from(MissionLog).where(MissionLog.user_id == user.id))
    assert count == 1


async def test_overdue_run_stays_active_and_last_step_completes(session: AsyncSession):
    user = await _user(session)
    await _path(session)
    start = DAY - timedelta(days=20)
    await _service(session, start).start(user.id, PathRunStart(slug="cs7", minutes_tier=7, preferred_slot="dawn"))
    for d in range(1, 4):
        await _complete(session, user, d, start + timedelta(days=d - 1))
    current = (await _service(session).get_current(user.id)).run
    # 끝나는 날을 지나도 자동으로 끝나지 않는다
    assert current is not None and current.status == "active" and current.overdue and current.next_step == 4
    assert current.preferred_slot == "dawn"

    for d in range(4, 8):
        result = await _complete(session, user, d, DAY + timedelta(days=d - 4))
    assert result.run.status == "completed" and result.run.next_step is None and result.run.finished_at is not None
    assert not result.run.overdue and result.run.done_steps == 7 and result.run.read_days == 7
    # 마침표를 볼 때까지 current 로 남고, 같은 장 재요청도 200
    assert (await _service(session).get_current(user.id)).run.status == "completed"
    assert (await _complete(session, user, 7, DAY + timedelta(days=3))).completion.day_index == 7
    assert await _codes(_service(session).abandon(user.id)) == "PATH_RUN_NOT_FOUND"


async def test_finish_actions(session: AsyncSession):
    user = await _user(session)
    await _path(session, days=1)
    await _path(session, slug="cs21", days=1)
    service = _service(session)
    await service.start(user.id, PathRunStart(slug="cs7", minutes_tier=7))
    assert await _codes(service.finish(user.id, PathRunFinishRequest(action="rest"))) == "PATH_RUN_NOT_COMPLETED"
    await _complete(session, user, 1, DAY)

    nxt = await service.finish(user.id, PathRunFinishRequest(action="next", slug="cs21"))
    assert nxt.run is not None and nxt.run.slug == "cs21" and nxt.run.status == "active"
    finished = (await session.execute(select(PathRun).where(PathRun.status == "completed"))).scalar_one()
    assert finished.finish_action == "next"

    await _complete(session, user, 1, DAY + timedelta(days=1))
    repeat = await _service(session, DAY + timedelta(days=1)).finish(user.id, PathRunFinishRequest(action="repeat"))
    assert repeat.run is not None and repeat.run.slug == "cs21" and repeat.run.done_steps == 0

    await _complete(session, user, 1, DAY + timedelta(days=2))
    assert (await service.finish(user.id, PathRunFinishRequest(action="rest"))).run is None
    assert (await service.get_current(user.id)).run is None


async def test_abandon_then_start_again(session: AsyncSession):
    user = await _user(session)
    await _path(session)
    service = _service(session)
    await service.start(user.id, PathRunStart(slug="cs7", minutes_tier=7))
    assert await _codes(service.start(user.id, PathRunStart(slug="cs7", minutes_tier=7))) == "PATH_RUN_ACTIVE"
    await _complete(session, user, 1, DAY)
    await service.abandon(user.id)
    assert (await service.get_current(user.id)).run is None
    restarted = (await service.start(user.id, PathRunStart(slug="cs7", minutes_tier=7))).run
    assert restarted is not None and restarted.done_steps == 0
    newcomer = await _user(session, "new@example.com")
    assert await _codes(service.start(newcomer.id, PathRunStart(slug="nope", minutes_tier=7))) == "PATH_NOT_FOUND"
    # 준비되지 않은 분량(3분 장 없음)
    assert await _codes(service.start(newcomer.id, PathRunStart(slug="cs7", minutes_tier=3))) == "PATH_NOT_FOUND"


async def test_mutual_exclusion_with_jeongseong_both_ways(session: AsyncSession):
    user = await _user(session)
    await _path(session)
    service = _service(session)
    # 정성 기간이 진행 중이면 7일 정성 시작 409
    await service.jeongseong.create(user.id, JeongseongCreate(topic="감사", duration_days=7))
    assert await _codes(service.start(user.id, PathRunStart(slug="cs7", minutes_tier=7))) == "JEONGSEONG_ACTIVE"
    # 끝나는 날이 지난 정성 기간은 정리되고 시작할 수 있다
    period = (await session.execute(select(JeongseongPeriod))).scalar_one()
    period.started_on = DAY - timedelta(days=7)
    await session.commit()
    assert (await service.start(user.id, PathRunStart(slug="cs7", minutes_tier=7))).run is not None
    await session.refresh(period)
    assert period.status == "completed"

    # 7일 정성이 진행 중이면(끝나는 날이 지나도) 정성 기간 시작 409
    run = (await session.execute(select(PathRun))).scalar_one()
    run.started_on = DAY - timedelta(days=30)
    await session.commit()
    assert await _codes(service.jeongseong.create(user.id, JeongseongCreate(topic="감사", duration_days=7))) == "PATH_RUN_ACTIVE"


async def test_rights_closed_403_and_withdrawn(session: AsyncSession):
    user = await _user(session)
    await _path(session, jeongseong=False)
    service = _service(session)
    assert (await service.list_paths()).paths == []
    assert await _codes(service.start(user.id, PathRunStart(slug="cs7", minutes_tier=7))) == "RIGHTS_CLOSED"

    right = (await session.execute(select(ContentRight))).scalar_one()
    right.scope_jeongseong = True
    await session.commit()
    listed = (await service.list_paths()).paths
    assert [(p.slug, [(t.minutes_tier, t.estimated_minutes, t.total_steps) for t in p.tiers]) for p in listed] == [
        ("cs7", [(7, 7, 7)])
    ]
    await service.start(user.id, PathRunStart(slug="cs7", minutes_tier=7))

    step = await service.get_step(user.id, 1)
    assert step.status == "available" and step.state == "next" and step.work_title == "천성경"
    assert [c.chunk_index for c in step.chunks] == [0, 1]
    assert step.chunks[1].display_text and step.chunks[0].chunk_id == _chunk_id(0)

    # 재적재로 chunk_id 가 어긋나면 다른 본문을 보이지 않는다
    moved = FakeQdrant()
    moved.points[2] = dataclasses.replace(moved.points[2], id="moved")
    assert (await _service(session, client=moved).get_step(user.id, 2)).status == "withdrawn"

    # 권리가 닫히면 200 withdrawn, 장 목록은 withdrawn 으로 건너뛴다
    right.scope_full_text = False
    await session.commit()
    closed = await service.get_step(user.id, 1)
    assert closed.status == "withdrawn" and closed.chunks == []
    current = (await service.get_current(user.id)).run
    assert current is not None and current.next_step is None and {s.state for s in current.steps} == {"withdrawn"}
    assert await _codes(service.get_step(user.id, 99)) == "PATH_STEP_NOT_FOUND"


async def test_account_delete_purges_path_rows(session: AsyncSession):
    me = await _user(session)
    other = await _user(session, "other@example.com")
    await _path(session, created_by=me.id)  # 공용 정성 — created_by 만 NULL 로
    mine = ReadingPath(slug="mine", title="내 정성", book="천성경", duration_days=3, kind="custom", owner_user_id=me.id)
    session.add(mine)
    await session.flush()
    session.add(
        ReadingPathStep(
            path_id=mine.id, path_version=1, minutes_tier=3, day_index=1, volume=VOLUME, start_chunk_index=0,
            end_chunk_index=0, start_chunk_id="a", end_chunk_id="a", title="1장", estimated_minutes=3,
        )
    )
    await session.commit()
    for user in (me, other):
        await _service(session).start(user.id, PathRunStart(slug="cs7", minutes_tier=7))
        await _complete(session, user, 1, DAY, note="내 기록")

    await IdentityService(UserRepository(session)).delete_account(me, purgers=[PathRepository(session)])
    runs = (await session.execute(select(PathRun))).scalars().all()
    assert [r.user_id for r in runs] == [other.id]
    completions = (await session.execute(select(PathStepCompletion))).scalars().all()
    assert [c.run_id for c in completions] == [runs[0].id]
    paths = (await session.execute(select(ReadingPath))).scalars().all()
    assert [(p.slug, p.created_by) for p in paths] == [("cs7", None)]
    steps = (await session.execute(select(ReadingPathStep).where(ReadingPathStep.path_id == mine.id))).all()
    assert steps == []


# --- 라우터 (실제 리포 + aiosqlite) --------------------------------------------------


@pytest.fixture
async def api(session: AsyncSession, monkeypatch):
    monkeypatch.setattr(settings, "hoondok_paths_enabled", True)
    monkeypatch.setattr(hoondok_deps, "get_raw_client", lambda: FakeQdrant())
    clock = {"today": DAY}

    async def _session():
        yield session

    app.dependency_overrides[get_async_session] = _session
    app.dependency_overrides[get_today_fn] = lambda: (lambda: clock["today"])
    try:
        client = TestClient(app)
        client.clock = clock  # type: ignore[attr-defined]
        yield client
    finally:
        app.dependency_overrides.pop(get_async_session, None)
        app.dependency_overrides.pop(get_today_fn, None)


async def test_router_flow_and_errors(api: TestClient, session: AsyncSession):
    assert api.get("/hoondok/me/path-runs/current").status_code == 401
    user = await _user(session)
    await _path(session)
    api.cookies.set(COOKIE_NAME, IdentityService.issue_token(user))

    assert api.get("/hoondok/me/path-runs/current").json() == {"run": None}
    assert [p["slug"] for p in api.get("/hoondok/paths").json()["paths"]] == ["cs7"]
    body = {"slug": "cs7", "minutes_tier": 7}
    assert api.post("/hoondok/me/path-runs", json=body).status_code == 403  # CSRF
    assert api.post("/hoondok/me/path-runs", json={**body, "minutes_tier": 5}, headers=XHR).status_code == 422
    created = api.post("/hoondok/me/path-runs", json=body, headers=XHR)
    assert created.status_code == 201, created.text
    run = created.json()["run"]
    assert run["next_step"] == 1 and run["today"] == DAY.isoformat() and run["slug"] == "cs7"

    dup = api.post("/hoondok/me/path-runs", json=body, headers=XHR)
    assert dup.status_code == 409 and dup.json()["error_code"] == "PATH_RUN_ACTIVE"
    js = api.post("/hoondok/me/jeongseong", json={"topic": "감사", "duration_days": 7}, headers=XHR)
    assert js.status_code == 409 and js.json()["error_code"] == "PATH_RUN_ACTIVE"

    step = api.get("/hoondok/me/path-runs/current/steps/1").json()
    assert step["status"] == "available" and len(step["chunks"]) == 2
    url = "/hoondok/me/path-runs/current/steps/1/complete"
    first = api.post(url, json={"note": "감사"}, headers=XHR)
    assert first.status_code == 200 and first.json()["completion"]["note"] == "감사"
    assert api.post(url, json={}, headers=XHR).json()["completion"]["note"] == "감사"
    assert api.post(url, json={"mode": "half"}, headers=XHR).status_code == 422  # half 는 1b
    second = api.post("/hoondok/me/path-runs/current/steps/2/complete", json={}, headers=XHR)
    assert second.status_code == 409 and second.json()["error_code"] == "ALREADY_READ_TODAY"

    assert api.delete("/hoondok/me/path-runs/current", headers=XHR).status_code == 204
    assert api.delete("/hoondok/me/path-runs/current", headers=XHR).json()["error_code"] == "PATH_RUN_NOT_FOUND"
    # 그만둔 뒤 정성 기간 시작 가능(플래그와 관계없는 상호 배제)
    assert api.post("/hoondok/me/jeongseong", json={"topic": "감사", "duration_days": 7}, headers=XHR).status_code == 201
    blocked = api.post("/hoondok/me/path-runs", json=body, headers=XHR)
    assert blocked.status_code == 409 and blocked.json()["error_code"] == "JEONGSEONG_ACTIVE"


async def test_router_flag_off_is_404(api: TestClient, session: AsyncSession, monkeypatch):
    monkeypatch.setattr(settings, "hoondok_paths_enabled", False)
    user = await _user(session)
    api.cookies.set(COOKIE_NAME, IdentityService.issue_token(user))
    for method, url in (
        ("get", "/hoondok/paths"),
        ("post", "/hoondok/me/path-runs"),
        ("get", "/hoondok/me/path-runs/current"),
        ("delete", "/hoondok/me/path-runs/current"),
        ("get", "/hoondok/me/path-runs/current/steps/1"),
        ("post", "/hoondok/me/path-runs/current/steps/1/complete"),
        ("post", "/hoondok/me/path-runs/current/finish"),
    ):
        assert getattr(api, method)(url, headers=XHR).status_code == 404, url


def test_note_only_in_own_path_run_responses():
    """남긴 한 줄(note)은 본인 /hoondok/me/path-runs 응답에만 — 관리자 경로 어디에도 없다."""
    schema = app.openapi()
    with_note = {
        name for name, body in schema["components"]["schemas"].items()
        if "note" in body.get("properties", {}) and name.startswith("Path")
    }
    assert with_note == {"PathStepSummary", "PathStepCompleteRequest", "PathStepCompletionView"}
    refs = {f"#/components/schemas/{name}" for name in with_note | {"PathRunView"}}
    paths = {path for path, ops in schema["paths"].items() if any(ref in json.dumps(ops) for ref in refs)}
    assert paths and all(p.startswith("/hoondok/me/path-runs") for p in paths)


# --- 시드 -----------------------------------------------------------------------------


def _fake_fetch(count: int, chars: int = 300):
    async def fetch(volume: str, lo: int, hi: int) -> list[Chunk]:
        return [Chunk(chunk_id=_chunk_id(i), chunk_index=i, chars=chars) for i in range(lo, min(hi, count))]

    return fetch


async def test_build_steps_groups_chunks_to_daily_minutes():
    sections = [
        VolumeSection(volume=VOLUME, position=1, level=1, title="제1편", start_chunk_index=0, end_chunk_index=99),
        VolumeSection(volume=VOLUME, position=2, level=2, title="1장", start_chunk_index=0, end_chunk_index=9),
        VolumeSection(volume=VOLUME, position=3, level=2, title="2장", start_chunk_index=10, end_chunk_index=99),
    ]
    steps = await build_steps(_fake_fetch(500), VOLUME, 0, 7, 3, sections, "천성경")
    # 3분 × 500자 = 1500자 → 300자 청크 5개씩
    assert [(s.start.chunk_index, s.end.chunk_index) for s in steps][:3] == [(0, 4), (5, 9), (10, 14)]
    assert [s.title for s in steps][:3] == ["1장", "1장", "2장"] and steps[0].estimated_minutes == 3
    with pytest.raises(SeedError):
        await build_steps(_fake_fetch(10), VOLUME, 0, 7, 3, sections, "천성경")


async def test_seed_paths_creates_three_paths_idempotent_and_fails_when_closed(session: AsyncSession):
    with pytest.raises(SeedError):  # 권리 원장에 없음
        await seed_paths(session, _fake_fetch(2000), publish=True)
    session.add(
        ContentRight(volume=VOLUME, status="allowed", scope_full_text=True, scope_jeongseong=True, work_title="천성경")
    )
    session.add(
        ContentRight(volume="평화경.txt", status="allowed", scope_full_text=True, scope_jeongseong=False, work_title="평화경")
    )
    await session.commit()
    with pytest.raises(SeedError, match="평화경"):  # 정성 이용 권리 닫힘
        await seed_paths(session, _fake_fetch(2000), publish=True)
    await session.rollback()

    volumes = {"천성경": VOLUME, "평화경": VOLUME}
    await seed_paths(session, _fake_fetch(2000), publish=True, volumes=volumes)
    paths = (await session.execute(select(ReadingPath).order_by(ReadingPath.sort_order))).scalars().all()
    assert [(p.slug, p.status, p.version, p.duration_days) for p in paths] == [
        ("cs7", "published", 1, 7), ("ph7", "published", 1, 7), ("cs21", "published", 1, 21)
    ]
    count = await session.scalar(select(func.count()).select_from(ReadingPathStep))
    assert count == (7 + 7 + 21) * 3
    # 21일 정성은 같은 분량 7일 정성이 끝난 다음 청크부터
    cs7_end = await session.scalar(
        select(func.max(ReadingPathStep.end_chunk_index)).where(
            ReadingPathStep.path_id == paths[0].id, ReadingPathStep.minutes_tier == 7
        )
    )
    cs21_start = await session.scalar(
        select(func.min(ReadingPathStep.start_chunk_index)).where(
            ReadingPathStep.path_id == paths[2].id, ReadingPathStep.minutes_tier == 7
        )
    )
    assert cs21_start == cs7_end + 1

    # 다시 돌려도 그대로, 청크 분량이 바뀌면 version+1 로 새 장
    await seed_paths(session, _fake_fetch(2000), publish=True, volumes=volumes)
    assert await session.scalar(select(func.count()).select_from(ReadingPathStep)) == count
    await seed_paths(session, _fake_fetch(4000, chars=600), publish=True, volumes=volumes)
    assert {p.version for p in (await session.execute(select(ReadingPath))).scalars()} == {2}
    assert await session.scalar(select(func.count()).select_from(ReadingPathStep)) == count * 2
