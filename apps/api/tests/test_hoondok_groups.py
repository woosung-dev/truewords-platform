"""훈독 함께 읽는 모임 API-HD-030~041 + D4 베타 게이트 + 계정 삭제 purger (PLAN-HD-010 §9).

aiosqlite 로 실 라우터·실 리포를 그대로 쓰고(get_async_session 교체), 날짜·시각만 GroupService 에 주입한다.
개인정보 경계는 응답 JSON 문자열 전체를 검색해 확인한다 — 필드 하나를 빠뜨린 새 스키마도 걸리게.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, func, select

import app.modules.hoondok.groups_service as groups_service
from app.core.common.database import get_async_session
from app.main import app
from app.modules.hoondok.dependencies import get_group_service, invite_join_limiter, invite_preview_limiter
from app.modules.hoondok.groups_repository import GroupRepository
from app.modules.hoondok.groups_service import GroupService, normalize_invite_code
from app.modules.hoondok.models import (
    ClientErrorEvent,
    DailyReading,
    GroupMember,
    GroupShare,
    JeongseongPeriod,
    JeongseongReading,
    MissionLog,
    NotificationPreference,
    PassageMark,
    PushSubscription,
    ReadingGroup,
    ReadingPosition,
    SharedJeongseong,
    ShareReaction,
)
from app.modules.identity.dependencies import COOKIE_NAME
from app.modules.identity.models import User
from app.modules.identity.service import IdentityService, check_invite_code
from app.modules.identity.exceptions import InviteRequiredError

XHR = {"X-Requested-With": "XMLHttpRequest"}
TODAY = date(2026, 9, 23)
NOW = datetime(2026, 9, 23, 3, 0)  # naive UTC = KST 12:00
CODE_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")
GROUP_TABLES = [ReadingGroup, GroupMember, SharedJeongseong, GroupShare, ShareReaction]


class Ctx:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.today = TODAY
        self.now = NOW

    async def user(self, name: str = "식구") -> User:
        user = User(email=f"{uuid.uuid4().hex}@example.com", password_hash="x", display_name=name)
        self.session.add(user)
        await self.session.commit()
        return user

    def client(self, user: User | None = None) -> TestClient:
        client = TestClient(app)
        if user is not None:
            client.cookies.set(COOKIE_NAME, IdentityService.issue_token(user))
        return client

    async def read(self, user: User, day: date | None = None, at: datetime | None = None) -> None:
        self.session.add(
            MissionLog(user_id=user.id, mission_date=day or self.today, kind="read", completed_at=at or self.now)
        )
        await self.session.commit()

    async def count(self, model) -> int:
        return int((await self.session.execute(select(func.count()).select_from(model))).scalar_one())


@pytest.fixture
async def ctx():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    tables = [
        User,
        MissionLog,
        DailyReading,
        JeongseongPeriod,
        JeongseongReading,
        ClientErrorEvent,
        NotificationPreference,
        PushSubscription,
        ReadingPosition,
        PassageMark,
        *GROUP_TABLES,
    ]
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[t.__table__ for t in tables])
    session = AsyncSession(engine, expire_on_commit=False)
    context = Ctx(session)

    async def _session():
        yield session

    app.dependency_overrides[get_async_session] = _session
    app.dependency_overrides[get_group_service] = lambda: GroupService(
        GroupRepository(session), today_fn=lambda: context.today, now_fn=lambda: context.now
    )
    invite_preview_limiter.reset()
    invite_join_limiter.reset()
    try:
        yield context
    finally:
        app.dependency_overrides.pop(get_async_session, None)
        app.dependency_overrides.pop(get_group_service, None)
        invite_preview_limiter.reset()
        invite_join_limiter.reset()
        await session.close()
        await engine.dispose()


def _create(client: TestClient, name: str = "새벽 모임", display_name: str = "가람", **extra) -> dict:
    res = client.post("/hoondok/groups", json={"name": name, "display_name": display_name, **extra}, headers=XHR)
    assert res.status_code == 201, res.text
    return res.json()


def _join(client: TestClient, code: str, display_name: str) -> dict:
    res = client.post(f"/hoondok/invites/{code}/join", json={"display_name": display_name}, headers=XHR)
    assert res.status_code == 201, res.text
    return res.json()


async def _group_of_three(ctx: Ctx) -> tuple[dict, dict[str, tuple[User, TestClient]]]:
    """리더 가람 + 식구 나래·다온."""
    people: dict[str, tuple[User, TestClient]] = {}
    for name in ("가람", "나래", "다온"):
        user = await ctx.user(name)
        people[name] = (user, ctx.client(user))
    group = _create(people["가람"][1])
    _join(people["나래"][1], group["invite_code"], "나래")
    _join(people["다온"][1], group["invite_code"], "다온")
    return group, people


# --- 초대 코드 형식 -----------------------------------------------------------


def test_invite_code_format_and_normalization():
    for _ in range(200):
        assert CODE_RE.match(groups_service.generate_invite_code())
    assert normalize_invite_code("abcd-efgh") == "ABCD-EFGH"
    assert normalize_invite_code(" abcdefgh ") == "ABCD-EFGH"
    assert normalize_invite_code("oIlO-1234") == "0110-1234"  # Crockford 별칭
    assert normalize_invite_code("ab cd-ef gh") == "ABCD-EFGH"
    for bad in (None, "", "ABC", "ABCD-EFGHJ", "UUUU-UUUU", "새벽-2026", "ABCD_EFGH"):
        assert normalize_invite_code(bad) is None


# --- 만들기 · 참여 -------------------------------------------------------------


async def test_create_group_makes_one_leader_and_code(ctx: Ctx):
    a = await ctx.user("가람")
    client = ctx.client(a)
    body = _create(client, meeting_time="06:00:00")
    assert CODE_RE.match(body["invite_code"])
    assert body["invite_expires_at"].startswith((NOW + timedelta(days=30)).date().isoformat())
    assert body["me"]["role"] == "leader" and body["leader_display_name"] == "가람"
    assert body["readers"] == [] and body["shares"] == [] and body["meeting_time"] == "06:00:00"
    assert "member_count" not in res_text(body)
    members = (await ctx.session.execute(select(GroupMember))).scalars().all()
    assert [(m.role, m.user_id) for m in members] == [("leader", a.id)]

    assert client.post("/hoondok/groups", json={"name": "x", "display_name": "y"}).status_code == 403  # CSRF
    assert ctx.client().post("/hoondok/groups", json={"name": "x", "display_name": "y"}, headers=XHR).status_code == 401
    assert ctx.client().get("/hoondok/me/groups").status_code == 401


def res_text(body: object) -> str:
    import json

    return json.dumps(body, ensure_ascii=False)


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "가" * 21, "display_name": "가람"},
        {"name": "   ", "display_name": "가람"},
        {"name": "모임", "display_name": "   "},
        {"name": "모임", "display_name": "가" * 13},
        {"name": "모임", "display_name": "가람", "jeongseong": {"title": "정성", "duration_days": 0, "started_on": "2026-09-23"}},
        {"name": "모임", "display_name": "가람", "jeongseong": {"title": "정성", "duration_days": 101, "started_on": "2026-09-23"}},
        {"name": "모임", "display_name": "가람", "jeongseong": {"title": "가" * 25, "duration_days": 7, "started_on": "2026-09-23"}},
        {"name": "모임", "display_name": "가람", "jeongseong": {"title": "정성", "duration_days": 7, "started_on": "2026-10-24"}},
    ],
)
async def test_create_validation_422(ctx: Ctx, payload: dict):
    client = ctx.client(await ctx.user())
    assert client.post("/hoondok/groups", json=payload, headers=XHR).status_code == 422
    assert await ctx.count(ReadingGroup) == 0


async def test_join_with_normalized_code_preview_and_already_member(ctx: Ctx):
    a, b = await ctx.user("가람"), await ctx.user("나래")
    group = _create(ctx.client(a))
    loose = group["invite_code"].replace("-", "").lower()
    cb = ctx.client(b)

    preview = cb.get(f"/hoondok/invites/{loose}")
    assert preview.status_code == 200, preview.text
    assert preview.json() == {
        "name": "새벽 모임",
        "kind": "small_group",
        "leader_display_name": "가람",
        "jeongseongs": [],
        "is_member": False,
        "group_id": None,
    }
    assert _join(cb, loose, "  나래  ") == {"group_id": group["id"]}
    again = cb.get(f"/hoondok/invites/{group['invite_code']}").json()
    assert again["is_member"] is True and again["group_id"] == group["id"]

    dup = cb.post(f"/hoondok/invites/{loose}/join", json={"display_name": "다른이름"}, headers=XHR)
    assert (dup.status_code, dup.json()["detail"]) == (409, "ALREADY_MEMBER")
    detail = cb.get(f"/hoondok/groups/{group['id']}").json()
    assert detail["me"]["display_name"] == "나래" and detail["me"]["role"] == "member"
    assert cb.post(f"/hoondok/invites/{loose}/join", json={"display_name": "x"}).status_code == 403  # CSRF


async def test_display_name_trimmed_duplicate_is_409_via_unique_constraint(ctx: Ctx):
    """앞뒤 공백만 다른 이름은 같은 이름 — 사전 조회 없이 DB unique → IntegrityError → 409 로 매핑된다."""
    a, b, c = await ctx.user(), await ctx.user(), await ctx.user()
    group = _create(ctx.client(a), display_name=" 가람 ")
    cb, cc = ctx.client(b), ctx.client(c)
    res = cb.post(f"/hoondok/invites/{group['invite_code']}/join", json={"display_name": "가람   "}, headers=XHR)
    assert (res.status_code, res.json()["detail"]) == (409, "DISPLAY_NAME_TAKEN")
    assert cb.post(f"/hoondok/invites/{group['invite_code']}/join", json={"display_name": "  "}, headers=XHR).status_code == 422
    _join(cb, group["invite_code"], "나래")
    _join(cc, group["invite_code"], "다온")
    # 이름 변경도 같은 규칙
    rename = cc.patch(f"/hoondok/groups/{group['id']}/me", json={"display_name": " 나래"}, headers=XHR)
    assert (rename.status_code, rename.json()["detail"]) == (409, "DISPLAY_NAME_TAKEN")
    ok = cc.patch(f"/hoondok/groups/{group['id']}/me", json={"display_name": "다온이"}, headers=XHR)
    assert ok.status_code == 200 and ok.json()["display_name"] == "다온이"
    assert await ctx.count(GroupMember) == 3


async def test_join_race_already_member_maps_integrity_error(ctx: Ctx, monkeypatch):
    """사전 검사를 통과한 뒤 unique(group,user) 가 막는 경쟁 — 409 ALREADY_MEMBER 로 매핑."""
    a, b = await ctx.user(), await ctx.user()
    group = _create(ctx.client(a))
    _join(ctx.client(b), group["invite_code"], "나래")
    real = GroupRepository.get_member
    calls = {"n": 0}

    async def racing_get_member(self, group_id, user_id):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(self, group_id, user_id)

    monkeypatch.setattr(GroupRepository, "get_member", racing_get_member)
    res = ctx.client(b).post(f"/hoondok/invites/{group['invite_code']}/join", json={"display_name": "또나래"}, headers=XHR)
    assert (res.status_code, res.json()["detail"]) == (409, "ALREADY_MEMBER")


async def test_join_recounts_capacity_after_locking_group(ctx: Ctx, monkeypatch):
    """정원은 모임 행 잠금(FOR UPDATE) 뒤에 센다 — 마지막 자리 경쟁에서 정원을 넘지 않는다."""
    order: list[str] = []
    real_lock, real_count = GroupRepository.get_group_for_update, GroupRepository.count_members

    async def lock(self, group_id):
        order.append("lock")
        return await real_lock(self, group_id)

    async def count(self, group_id):
        order.append("count")
        return await real_count(self, group_id)

    a, b = await ctx.user(), await ctx.user()
    group = _create(ctx.client(a))
    monkeypatch.setattr(GroupRepository, "get_group_for_update", lock)
    monkeypatch.setattr(GroupRepository, "count_members", count)
    _join(ctx.client(b), group["invite_code"], "나래")
    assert order.index("lock") < order.index("count")


async def test_invalid_expired_and_regenerated_codes_are_identical_404(ctx: Ctx):
    a, b = await ctx.user("가람"), await ctx.user("나래")
    ca, cb = ctx.client(a), ctx.client(b)
    group = _create(ca)
    old = group["invite_code"]

    def not_found(code: str) -> None:
        for res in (
            cb.get(f"/hoondok/invites/{code}"),
            cb.post(f"/hoondok/invites/{code}/join", json={"display_name": "나래"}, headers=XHR),
        ):
            assert (res.status_code, res.json()) == (404, {"detail": "INVITE_NOT_FOUND"})

    not_found("ZZZZ-ZZZZ")
    not_found("아무거나")

    ctx.now = NOW + timedelta(days=30)  # 만료 시각 도달
    not_found(old)
    ctx.now = NOW + timedelta(days=29)
    regen = ca.post(f"/hoondok/groups/{group['id']}/invite", headers=XHR)
    assert regen.status_code == 200 and CODE_RE.match(regen.json()["invite_code"])
    new = regen.json()["invite_code"]
    assert new != old and regen.json()["invite_expires_at"].startswith("2026-11-21")
    not_found(old)  # 이전 코드 즉시 무효
    _join(cb, new, "나래")


async def test_group_full_join_409_preview_404(ctx: Ctx, monkeypatch):
    monkeypatch.setattr(groups_service, "GROUP_CAPACITY", 2)
    a, b, c = await ctx.user(), await ctx.user(), await ctx.user()
    group = _create(ctx.client(a))
    _join(ctx.client(b), group["invite_code"], "나래")
    cc = ctx.client(c)
    assert cc.get(f"/hoondok/invites/{group['invite_code']}").json() == {"detail": "INVITE_NOT_FOUND"}
    res = cc.post(f"/hoondok/invites/{group['invite_code']}/join", json={"display_name": "다온"}, headers=XHR)
    assert (res.status_code, res.json()["detail"]) == (409, "GROUP_FULL")
    # 이미 모임원은 정원이 차도 미리보기에서 자기 모임을 본다
    assert ctx.client(b).get(f"/hoondok/invites/{group['invite_code']}").json()["is_member"] is True


async def test_leader_and_join_limits(ctx: Ctx):
    a, c = await ctx.user("가람"), await ctx.user("다온")
    ca, cc = ctx.client(a), ctx.client(c)
    a_groups = [_create(ca, name=f"가람{i}") for i in range(3)]
    for i in range(3):
        _create(cc, name=f"다온{i}", display_name="다온")
    over = cc.post("/hoondok/groups", json={"name": "넷째", "display_name": "다온"}, headers=XHR)
    assert (over.status_code, over.json()["detail"]) == (409, "LEADER_LIMIT")
    _join(cc, a_groups[0]["invite_code"], "다온")
    _join(cc, a_groups[1]["invite_code"], "다온")  # 이제 5개
    res = cc.post(f"/hoondok/invites/{a_groups[2]['invite_code']}/join", json={"display_name": "다온"}, headers=XHR)
    assert (res.status_code, res.json()["detail"]) == (409, "JOIN_LIMIT")
    assert len(cc.get("/hoondok/me/groups").json()) == 5


async def test_invite_preview_limiter_31st_request_is_429_and_join_is_independent(ctx: Ctx):
    client = ctx.client(await ctx.user())
    for _ in range(30):
        assert client.get("/hoondok/invites/ZZZZ-ZZZZ").status_code == 404
    blocked = client.get("/hoondok/invites/ZZZZ-ZZZZ")
    assert blocked.status_code == 429 and blocked.json()["error_code"] == "RATE_LIMIT_EXCEEDED"
    # 미리보기 한도를 다 써도 참여는 따로 센다
    res = client.post("/hoondok/invites/ZZZZ-ZZZZ/join", json={"display_name": "x"}, headers=XHR)
    assert res.status_code == 404


async def test_invite_join_limiter_31st_request_is_429_and_preview_is_independent(ctx: Ctx):
    client = ctx.client(await ctx.user())
    for _ in range(30):
        res = client.post("/hoondok/invites/ZZZZ-ZZZZ/join", json={"display_name": "x"}, headers=XHR)
        assert res.status_code == 404
    blocked = client.post("/hoondok/invites/ZZZZ-ZZZZ/join", json={"display_name": "x"}, headers=XHR)
    assert blocked.status_code == 429 and blocked.json()["error_code"] == "RATE_LIMIT_EXCEEDED"
    assert client.get("/hoondok/invites/ZZZZ-ZZZZ").status_code == 404


# --- 완료자만 · 개인정보 -------------------------------------------------------


async def test_only_completers_are_visible_and_no_member_count_anywhere(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    (a, ca), (b, cb), (c, _) = people["가람"], people["나래"], people["다온"]
    await ctx.read(b, at=datetime(2026, 9, 22, 21, 10))  # KST 9/23 06:10

    detail = ca.get(f"/hoondok/groups/{group['id']}").json()
    assert detail["readers"] == [
        {"display_name": "나래", "read_at_kst": "2026-09-23T06:10:00+09:00", "is_me": False, "is_leader": False}
    ]
    my_groups = cb.get("/hoondok/me/groups").json()
    assert my_groups[0]["today_read_count"] == 1 and my_groups[0]["readers_preview"] == ["나"]
    d = await ctx.user("라온")
    preview = ctx.client(d).get(f"/hoondok/invites/{group['invite_code']}").json()

    for label, body in {
        "detail-leader": detail,
        "detail-member": cb.get(f"/hoondok/groups/{group['id']}").json(),
        "me-groups": my_groups,
        "preview": preview,
    }.items():
        text = res_text(body)
        assert "다온" not in text, label  # 미완료자 이름
        for user in (a, b, c):
            assert str(user.id) not in text, label
        assert "member_count" not in text and "has_read" not in text.replace("has_read_today", ""), label
    assert "나래" not in res_text(preview)  # 미리보기에는 리더 이름만


async def test_readers_sorted_ganada(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    for name in ("다온", "가람", "나래"):
        await ctx.read(people[name][0])
    readers = people["다온"][1].get(f"/hoondok/groups/{group['id']}").json()["readers"]
    assert [r["display_name"] for r in readers] == ["가람", "나래", "다온"]
    assert [r["is_me"] for r in readers] == [False, False, True]
    assert [r["is_leader"] for r in readers] == [True, False, False]


async def test_kst_midnight_boundary_for_readers_and_shares(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    (b, cb), (c, cc) = people["나래"], people["다온"]
    # 어제 23:59 KST(= 어제 14:59 UTC) 완료는 오늘 목록에 없다
    await ctx.read(b, day=TODAY - timedelta(days=1), at=datetime(2026, 9, 22, 14, 59))
    ctx.session.add(
        GroupShare(
            group_id=uuid.UUID(group["id"]),
            member_id=uuid.UUID(cb.get(f"/hoondok/groups/{group['id']}").json()["me"]["member_id"]),
            share_date=TODAY - timedelta(days=1),
            body="어제의 한 줄",
        )
    )
    await ctx.session.commit()
    detail = cc.get(f"/hoondok/groups/{group['id']}").json()
    assert detail["readers"] == [] and detail["shares"] == []
    assert "어제의 한 줄" not in res_text(detail)
    stale = (await ctx.session.execute(select(GroupShare))).scalars().one()
    assert cc.put(f"/hoondok/groups/{group['id']}/shares/{stale.id}/reaction", headers=XHR).status_code == 404

    # 오늘 쓴 한 줄도 자정이 지나면 사라진다
    await ctx.read(c)
    assert cc.put(f"/hoondok/groups/{group['id']}/shares/today", json={"body": "오늘"}, headers=XHR).status_code == 200
    ctx.today = TODAY + timedelta(days=1)
    tomorrow = cc.get(f"/hoondok/groups/{group['id']}").json()
    assert tomorrow["readers"] == [] and tomorrow["shares"] == []
    assert tomorrow["me"]["has_read_today"] is False and tomorrow["me"]["has_shared_today"] is False
    assert cc.put(f"/hoondok/groups/{group['id']}/shares/today", json={"body": "내일"}, headers=XHR).json()["detail"] == "READ_REQUIRED"


async def test_detail_shares_only_from_todays_readers(ctx: Ctx):
    """읽음 기록이 없는 작성자의 오늘 한 줄은 상세에 나오지 않는다(한 줄은 오늘 완료자만)."""
    group, people = await _group_of_three(ctx)
    (b, cb), (c, cc) = people["나래"], people["다온"]
    gid = group["id"]
    await ctx.read(b)
    assert cb.put(f"/hoondok/groups/{gid}/shares/today", json={"body": "읽은 사람"}, headers=XHR).status_code == 200
    # 다온은 오늘 읽지 않았는데 한 줄만 남아 있는 상태(날짜 경계·데이터 정정 등)를 직접 만든다
    ctx.session.add(
        GroupShare(
            group_id=uuid.UUID(gid),
            member_id=uuid.UUID(cc.get(f"/hoondok/groups/{gid}").json()["me"]["member_id"]),
            share_date=TODAY,
            body="안 읽은 사람",
        )
    )
    await ctx.session.commit()
    for client in (cb, cc, people["가람"][1]):
        detail = client.get(f"/hoondok/groups/{gid}").json()
        assert [share["body"] for share in detail["shares"]] == ["읽은 사람"]
        assert "안 읽은 사람" not in res_text(detail)
    assert cc.get(f"/hoondok/groups/{gid}").json()["me"]["has_shared_today"] is False


# --- 권한 ------------------------------------------------------------------


async def test_non_member_gets_404_everywhere(ctx: Ctx):
    group, _ = await _group_of_three(ctx)
    outsider = ctx.client(await ctx.user("라온"))
    gid, fake = group["id"], uuid.uuid4()
    calls = [
        ("get", f"/hoondok/groups/{gid}", None),
        ("patch", f"/hoondok/groups/{gid}", {"name": "x"}),
        ("delete", f"/hoondok/groups/{gid}", None),
        ("post", f"/hoondok/groups/{gid}/invite", None),
        ("patch", f"/hoondok/groups/{gid}/me", {"display_name": "x"}),
        ("delete", f"/hoondok/groups/{gid}/me", None),
        ("get", f"/hoondok/groups/{gid}/members", None),
        ("delete", f"/hoondok/groups/{gid}/members/{fake}", None),
        ("post", f"/hoondok/groups/{gid}/jeongseongs", {"title": "t", "duration_days": 7, "started_on": "2026-09-23"}),
        ("delete", f"/hoondok/groups/{gid}/jeongseongs/{fake}", None),
        ("put", f"/hoondok/groups/{gid}/shares/today", {"body": "x"}),
        ("delete", f"/hoondok/groups/{gid}/shares/{fake}", None),
        ("put", f"/hoondok/groups/{gid}/shares/{fake}/reaction", None),
        ("delete", f"/hoondok/groups/{gid}/shares/{fake}/reaction", None),
        ("get", f"/hoondok/groups/{fake}", None),
    ]
    for method, path, body in calls:
        kwargs = {"headers": XHR}
        if body is not None:
            kwargs["json"] = body
        res = getattr(outsider, method)(path, **kwargs)
        assert res.status_code == 404, (method, path, res.text)
        assert res.json() == {"detail": "GROUP_NOT_FOUND"}, (method, path)
    assert await ctx.count(ReadingGroup) == 1


async def test_member_gets_403_on_leader_only_routes_and_no_invite_code(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    cb = people["나래"][1]
    gid = group["id"]
    leader_member_id = people["가람"][1].get(f"/hoondok/groups/{gid}").json()["me"]["member_id"]
    for method, path, body in [
        ("patch", f"/hoondok/groups/{gid}", {"name": "x"}),
        ("delete", f"/hoondok/groups/{gid}", None),
        ("post", f"/hoondok/groups/{gid}/invite", None),
        ("get", f"/hoondok/groups/{gid}/members", None),
        ("delete", f"/hoondok/groups/{gid}/members/{leader_member_id}", None),
        ("post", f"/hoondok/groups/{gid}/jeongseongs", {"title": "t", "duration_days": 7, "started_on": "2026-09-23"}),
    ]:
        kwargs = {"headers": XHR}
        if body is not None:
            kwargs["json"] = body
        res = getattr(cb, method)(path, **kwargs)
        assert (res.status_code, res.json()) == (403, {"detail": "LEADER_ONLY"}), (method, path)
    detail = cb.get(f"/hoondok/groups/{gid}").json()
    assert detail["invite_code"] is None and detail["invite_expires_at"] is None
    assert group["invite_code"] not in res_text(detail)
    assert cb.delete(f"/hoondok/groups/{gid}/me").status_code == 403  # CSRF


async def test_leader_member_list_and_rename(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    ca = people["가람"][1]
    gid = group["id"]
    members = ca.get(f"/hoondok/groups/{gid}/members").json()
    assert members["member_count"] == 3
    assert [m["display_name"] for m in members["items"]] == ["가람", "나래", "다온"]
    assert all(set(m) == {"id", "display_name", "role", "joined_at"} for m in members["items"])
    me_id = members["items"][0]["id"]
    self_kick = ca.delete(f"/hoondok/groups/{gid}/members/{me_id}", headers=XHR)
    assert (self_kick.status_code, self_kick.json()["detail"]) == (409, "CANNOT_REMOVE_SELF")
    assert ca.delete(f"/hoondok/groups/{gid}/members/{uuid.uuid4()}", headers=XHR).json()["detail"] == "MEMBER_NOT_FOUND"
    renamed = ca.patch(f"/hoondok/groups/{gid}", json={"name": "  저녁 모임 "}, headers=XHR)
    assert renamed.status_code == 200 and renamed.json()["name"] == "저녁 모임"
    assert ca.patch(f"/hoondok/groups/{gid}", json={"name": "가" * 21}, headers=XHR).status_code == 422


# --- 한 줄 · 반응 ------------------------------------------------------------


async def test_share_requires_read_and_upserts_one_per_day(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    b, cb = people["나래"]
    gid = group["id"]
    url = f"/hoondok/groups/{gid}/shares/today"
    blocked = cb.put(url, json={"body": "먼저"}, headers=XHR)
    assert (blocked.status_code, blocked.json()) == (409, {"detail": "READ_REQUIRED"})
    await ctx.read(b)
    first = cb.put(url, json={"body": "  첫 줄  \r\n\n\n  둘째    줄 "}, headers=XHR)
    assert first.status_code == 200, first.text
    assert first.json()["body"] == "첫 줄\n둘째 줄"
    assert first.json()["is_mine"] is True and first.json()["reaction_count"] == 0
    second = cb.put(url, json={"body": "고쳐 쓴 줄"}, headers=XHR)
    assert second.json()["id"] == first.json()["id"] and second.json()["body"] == "고쳐 쓴 줄"
    assert await ctx.count(GroupShare) == 1
    assert cb.put(url, json={"body": "가" * 101}, headers=XHR).status_code == 422
    assert cb.put(url, json={"body": " \n  \n "}, headers=XHR).status_code == 422
    assert cb.put(url, json={"body": "가" * 100}, headers=XHR).status_code == 200


async def test_reactions_count_only_for_author(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    (_, ca), (b, cb), (_, cc) = people["가람"], people["나래"], people["다온"]
    gid = group["id"]
    await ctx.read(b)
    share_id = cb.put(f"/hoondok/groups/{gid}/shares/today", json={"body": "함께"}, headers=XHR).json()["id"]
    react = f"/hoondok/groups/{gid}/shares/{share_id}/reaction"

    assert cc.put(react, headers=XHR).json() == {"has_reacted": True}
    assert cc.put(react, headers=XHR).json() == {"has_reacted": True}  # 멱등
    assert ca.put(react, headers=XHR).status_code == 200
    own = cb.put(react, headers=XHR)
    assert (own.status_code, own.json()["detail"]) == (409, "OWN_SHARE")
    assert await ctx.count(ShareReaction) == 2

    author_view = cb.get(f"/hoondok/groups/{gid}").json()["shares"][0]
    assert author_view["is_mine"] is True and author_view["reaction_count"] == 2
    for client in (ca, cc):
        other_view = client.get(f"/hoondok/groups/{gid}").json()["shares"][0]
        assert other_view["is_mine"] is False and other_view["reaction_count"] is None
        assert other_view["has_my_reaction"] is True
        assert set(other_view) == {"id", "display_name", "body", "created_at_kst", "is_mine", "has_my_reaction", "reaction_count"}

    assert cc.delete(react, headers=XHR).json() == {"has_reacted": False}
    assert cc.delete(react, headers=XHR).json() == {"has_reacted": False}
    assert cb.get(f"/hoondok/groups/{gid}").json()["shares"][0]["reaction_count"] == 1


async def test_share_delete_by_author_or_leader_only(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    (_, ca), (b, cb), (c, cc) = people["가람"], people["나래"], people["다온"]
    gid = group["id"]
    for user in (b, c):
        await ctx.read(user)
    b_share = cb.put(f"/hoondok/groups/{gid}/shares/today", json={"body": "나래"}, headers=XHR).json()["id"]
    c_share = cc.put(f"/hoondok/groups/{gid}/shares/today", json={"body": "다온"}, headers=XHR).json()["id"]
    cc.put(f"/hoondok/groups/{gid}/shares/{b_share}/reaction", headers=XHR)

    other = cc.delete(f"/hoondok/groups/{gid}/shares/{b_share}", headers=XHR)
    assert (other.status_code, other.json()["detail"]) == (403, "NOT_ALLOWED")
    assert cb.delete(f"/hoondok/groups/{gid}/shares/{b_share}", headers=XHR).status_code == 204  # 작성자
    assert ca.delete(f"/hoondok/groups/{gid}/shares/{c_share}", headers=XHR).status_code == 204  # 리더
    assert await ctx.count(GroupShare) == 0 and await ctx.count(ShareReaction) == 0
    assert ca.delete(f"/hoondok/groups/{gid}/shares/{c_share}", headers=XHR).json()["detail"] == "SHARE_NOT_FOUND"


# --- 탈퇴 · 내보내기 · 삭제 ------------------------------------------------------


async def test_kick_removes_member_shares_and_reactions(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    (_, ca), (b, cb), (c, cc) = people["가람"], people["나래"], people["다온"]
    gid = group["id"]
    for user in (b, c):
        await ctx.read(user)
    b_share = cb.put(f"/hoondok/groups/{gid}/shares/today", json={"body": "나래의 줄"}, headers=XHR).json()["id"]
    c_share = cc.put(f"/hoondok/groups/{gid}/shares/today", json={"body": "다온의 줄"}, headers=XHR).json()["id"]
    cb.put(f"/hoondok/groups/{gid}/shares/{c_share}/reaction", headers=XHR)  # 나래 → 다온
    cc.put(f"/hoondok/groups/{gid}/shares/{b_share}/reaction", headers=XHR)  # 다온 → 나래
    c_view = {s["body"]: s for s in cc.get(f"/hoondok/groups/{gid}").json()["shares"]}
    assert c_view["다온의 줄"]["reaction_count"] == 1

    b_member = cb.get(f"/hoondok/groups/{gid}").json()["me"]["member_id"]
    assert ca.delete(f"/hoondok/groups/{gid}/members/{b_member}", headers=XHR).status_code == 204

    assert cb.get(f"/hoondok/groups/{gid}").json() == {"detail": "GROUP_NOT_FOUND"}
    assert cb.get("/hoondok/me/groups").json() == []
    view = cc.get(f"/hoondok/groups/{gid}").json()
    assert [r["display_name"] for r in view["readers"]] == ["다온"]
    assert [s["body"] for s in view["shares"]] == ["다온의 줄"]
    assert view["shares"][0]["reaction_count"] == 0  # 내보낸 사람의 반응도 사라진다
    assert "나래" not in res_text(view)
    assert await ctx.count(GroupShare) == 1 and await ctx.count(ShareReaction) == 0
    # 다시 초대 코드로 들어올 수 있다
    _join(cb, group["invite_code"], "나래")


async def test_leave_member_and_leader_rules(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    ca, cb = people["가람"][1], people["나래"][1]
    gid = group["id"]
    blocked = ca.delete(f"/hoondok/groups/{gid}/me", headers=XHR)
    assert (blocked.status_code, blocked.json()["detail"]) == (409, "LEADER_MUST_HANDOVER")
    assert cb.delete(f"/hoondok/groups/{gid}/me", headers=XHR).status_code == 204
    assert cb.get(f"/hoondok/groups/{gid}").status_code == 404
    b_member = ca.get(f"/hoondok/groups/{gid}/members").json()
    assert b_member["member_count"] == 2
    c_member = next(m["id"] for m in b_member["items"] if m["display_name"] == "다온")
    ca.delete(f"/hoondok/groups/{gid}/members/{c_member}", headers=XHR)
    # 혼자 남은 리더가 나가면 모임이 지워진다
    assert ca.delete(f"/hoondok/groups/{gid}/me", headers=XHR).status_code == 204
    for model in GROUP_TABLES:
        assert await ctx.count(model) == 0, model


async def test_delete_group_removes_all_children(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    ca, (b, cb) = people["가람"][1], people["나래"]
    gid = group["id"]
    await ctx.read(b)
    share = cb.put(f"/hoondok/groups/{gid}/shares/today", json={"body": "줄"}, headers=XHR).json()["id"]
    ca.put(f"/hoondok/groups/{gid}/shares/{share}/reaction", headers=XHR)
    ca.post(f"/hoondok/groups/{gid}/jeongseongs", json={"title": "21일", "duration_days": 21, "started_on": "2026-09-23"}, headers=XHR)
    ctx.session.add(SharedJeongseong(group_id=None, title="공식", started_on=TODAY, duration_days=40))
    await ctx.session.commit()

    assert ca.delete(f"/hoondok/groups/{gid}", headers=XHR).status_code == 204
    for model in (ReadingGroup, GroupMember, GroupShare, ShareReaction):
        assert await ctx.count(model) == 0, model
    remaining = (await ctx.session.execute(select(SharedJeongseong))).scalars().all()
    assert [js.title for js in remaining] == ["공식"]  # 공식 정성은 남는다
    assert cb.get(f"/hoondok/groups/{gid}").status_code == 404


# --- 정성 -------------------------------------------------------------------


async def test_jeongseongs_official_everywhere_day_index_and_limit(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    ca = people["가람"][1]
    gid = group["id"]
    other = _create(ctx.client(await ctx.user("라온")), name="다른 모임", display_name="라온")
    for title, started, days in (
        ("진행 공식", TODAY - timedelta(days=2), 40),
        ("예정 공식", TODAY + timedelta(days=5), 7),
        ("끝난 공식", TODAY - timedelta(days=10), 7),
    ):
        note = "협회 공지 2026-09" if title == "진행 공식" else None
        ctx.session.add(
            SharedJeongseong(group_id=None, title=title, started_on=started, duration_days=days, source_note=note)
        )
    await ctx.session.commit()

    for client, group_id in ((ca, gid), (ctx.client((await ctx.session.execute(select(User).where(User.display_name == "라온"))).scalar_one()), other["id"])):
        items = {j["title"]: j for j in client.get(f"/hoondok/groups/{group_id}").json()["jeongseongs"]}
        assert set(items) == {"진행 공식", "예정 공식"}
        assert (items["진행 공식"]["day_index"], items["진행 공식"]["state"], items["진행 공식"]["is_official"]) == (3, "active", True)
        assert (items["예정 공식"]["day_index"], items["예정 공식"]["state"]) == (None, "upcoming")
        # 공식 정성 출처는 관리자 입력 그대로, 미입력은 null (QA P2-13)
        assert (items["진행 공식"]["source_note"], items["예정 공식"]["source_note"]) == ("협회 공지 2026-09", None)
    # API-HD-030 내 모임 · API-HD-035 초대 미리보기에도 같은 항목이 간다
    mine = {j["title"]: j for j in ca.get("/hoondok/me/groups").json()[0]["jeongseongs"]}
    assert mine["진행 공식"]["source_note"] == "협회 공지 2026-09"
    preview = ctx.client(await ctx.user("마루")).get(f"/hoondok/invites/{group['invite_code']}").json()
    assert {j["title"]: j["source_note"] for j in preview["jeongseongs"]}["진행 공식"] == "협회 공지 2026-09"

    url = f"/hoondok/groups/{gid}/jeongseongs"
    created = ca.post(url, json={"title": " 모임 21일 ", "duration_days": 21, "started_on": "2026-09-23"}, headers=XHR)
    assert created.status_code == 201 and created.json()["is_official"] is False and created.json()["day_index"] == 1
    assert created.json()["source_note"] is None
    assert created.json()["title"] == "모임 21일"
    ca.post(url, json={"title": "둘", "duration_days": 7, "started_on": "2026-09-20"}, headers=XHR)
    ca.post(url, json={"title": "셋", "duration_days": 7, "started_on": "2026-10-01"}, headers=XHR)
    fourth = ca.post(url, json={"title": "넷", "duration_days": 7, "started_on": "2026-09-23"}, headers=XHR)
    assert (fourth.status_code, fourth.json()["detail"]) == (409, "JEONGSEONG_LIMIT")
    for payload in (
        {"title": "먼 과거", "duration_days": 100, "started_on": "2026-08-23"},
        {"title": "먼 미래", "duration_days": 7, "started_on": "2026-10-24"},
        {"title": "이미 끝남", "duration_days": 3, "started_on": "2026-09-01"},
    ):
        assert ca.post(url, json=payload, headers=XHR).status_code == 422, payload
    assert len(ctx.client((await ctx.session.execute(select(User).where(User.display_name == "라온"))).scalar_one()).get(f"/hoondok/groups/{other['id']}").json()["jeongseongs"]) == 2  # 남의 모임 정성은 안 보인다

    official = (await ctx.session.execute(select(SharedJeongseong).where(SharedJeongseong.title == "진행 공식"))).scalar_one()
    assert ca.delete(f"{url}/{official.id}", headers=XHR).json()["detail"] == "JEONGSEONG_NOT_FOUND"
    assert ca.delete(f"{url}/{created.json()['id']}", headers=XHR).status_code == 204
    # 끝난 정성은 한도에서 빠진다 → 다시 추가 가능
    assert ca.post(url, json={"title": "다시", "duration_days": 7, "started_on": "2026-09-23"}, headers=XHR).status_code == 201

    my = ca.get("/hoondok/me/groups").json()[0]
    assert {j["title"] for j in my["jeongseongs"]} >= {"진행 공식", "예정 공식", "다시"}


async def test_create_with_jeongseong_and_today_reading(ctx: Ctx):
    ctx.session.add(
        DailyReading(
            reading_date=TODAY,
            title="오늘 말씀",
            body="본문",
            speaker="참아버님",
            work_title="천성경",
            authority_grade="O1",
            review_status="reviewed",
            chunk_id="c-1",
        )
    )
    await ctx.session.commit()
    client = ctx.client(await ctx.user())
    body = _create(client, jeongseong={"title": "40일 정성", "duration_days": 40, "started_on": "2026-09-23"})
    assert body["jeongseongs"][0]["title"] == "40일 정성" and body["jeongseongs"][0]["day_index"] == 1
    assert body["today_reading"]["title"] == "오늘 말씀" and body["today_reading"]["chunk_id"] == "c-1"
    assert "본문" not in res_text(body["today_reading"])  # 요약만
    reading = (await ctx.session.execute(select(DailyReading))).scalar_one()
    reading.review_status = "withdrawn"
    await ctx.session.commit()
    assert client.get(f"/hoondok/groups/{body['id']}").json()["today_reading"] is None


# --- 계정 삭제 purger --------------------------------------------------------


async def test_account_deletion_transfers_leader_to_earliest_member(ctx: Ctx):
    group, people = await _group_of_three(ctx)
    (a, ca), (b, cb), (_, cc) = people["가람"], people["나래"], people["다온"]
    gid = group["id"]
    solo = _create(ca, name="혼자 모임")
    await ctx.read(a)
    await ctx.read(b)
    a_share = ca.put(f"/hoondok/groups/{gid}/shares/today", json={"body": "가람"}, headers=XHR).json()["id"]
    b_share = cb.put(f"/hoondok/groups/{gid}/shares/today", json={"body": "나래"}, headers=XHR).json()["id"]
    ca.put(f"/hoondok/groups/{gid}/shares/{b_share}/reaction", headers=XHR)
    cc.put(f"/hoondok/groups/{gid}/shares/{a_share}/reaction", headers=XHR)
    js = ca.post(f"/hoondok/groups/{gid}/jeongseongs", json={"title": "정성", "duration_days": 7, "started_on": "2026-09-23"}, headers=XHR)
    assert js.status_code == 201

    assert ca.delete("/hoondok/auth/me", headers=XHR).status_code == 204

    view = cb.get(f"/hoondok/groups/{gid}").json()
    assert view["me"]["role"] == "leader" and view["leader_display_name"] == "나래"  # 가장 먼저 들어온 식구
    assert view["invite_code"] == group["invite_code"]
    assert [s["body"] for s in view["shares"]] == ["나래"] and view["shares"][0]["reaction_count"] == 0
    assert cc.get(f"/hoondok/groups/{gid}").json()["me"]["role"] == "member"
    assert (await ctx.session.execute(select(ReadingGroup).where(ReadingGroup.id == uuid.UUID(solo["id"])))).first() is None
    assert await ctx.count(ShareReaction) == 0
    remaining = (await ctx.session.execute(select(SharedJeongseong))).scalars().all()
    assert [(j.title, j.created_by_user_id) for j in remaining] == [("정성", None)]
    leaders = (await ctx.session.execute(select(GroupMember).where(GroupMember.role == "leader"))).scalars().all()
    assert len(leaders) == 1


# --- D4 베타 게이트: 모임 초대 코드로 가입 --------------------------------------


def _signup(client: TestClient, email: str, invite_code: str | None):
    body = {"email": email, "password": "password1", "display_name": "새 식구"}
    if invite_code is not None:
        body["invite_code"] = invite_code
    return client.post("/hoondok/auth/signup", json=body, headers=XHR)


async def test_signup_gate_accepts_valid_group_code(ctx: Ctx, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "hoondok_invite_code", SecretStr("새벽-2026"))
    leader = await ctx.user("가람")
    group = _create(ctx.client(leader))
    client = ctx.client()

    ok = _signup(client, "g1@example.com", group["invite_code"].replace("-", "").lower())
    assert ok.status_code == 201, ok.text
    assert _signup(ctx.client(), "g2@example.com", "새벽-2026").status_code == 201  # 전역 코드는 그대로
    # 가입만 통과시키고 모임에는 넣지 않는다
    assert await ctx.count(GroupMember) == 1

    for code in ("ZZZZ-ZZZZ", "틀린코드", None):
        res = _signup(ctx.client(), f"bad-{uuid.uuid4().hex[:6]}@example.com", code)
        assert (res.status_code, res.json()["error_code"]) == (403, "INVITE_REQUIRED"), code

    ctx.now = NOW + timedelta(days=31)  # 만료된 모임 코드
    expired = _signup(ctx.client(), "g3@example.com", group["invite_code"])
    assert (expired.status_code, expired.json()["error_code"]) == (403, "INVITE_REQUIRED")


async def test_signup_gate_rejects_full_group_code(ctx: Ctx, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "hoondok_invite_code", SecretStr("새벽-2026"))
    monkeypatch.setattr(groups_service, "GROUP_CAPACITY", 1)
    group = _create(ctx.client(await ctx.user()))
    res = _signup(ctx.client(), "full@example.com", group["invite_code"])
    assert (res.status_code, res.json()["error_code"]) == (403, "INVITE_REQUIRED")


async def test_signup_gate_group_codes_share_join_limiter(ctx: Ctx, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "hoondok_invite_code", SecretStr("새벽-2026"))
    client = ctx.client()
    for i in range(30):
        assert _signup(client, f"l{i}@example.com", "ZZZZ-ZZZZ").status_code == 403
    assert _signup(client, "l30@example.com", "ZZZZ-ZZZZ").status_code == 429
    # 가입 게이트는 참여 limiter 를 공유한다 — 참여도 막히고 미리보기는 따로 센다
    member = ctx.client(await ctx.user())
    assert member.post("/hoondok/invites/ZZZZ-ZZZZ/join", json={"display_name": "x"}, headers=XHR).status_code == 429
    assert member.get("/hoondok/invites/ZZZZ-ZZZZ").status_code == 404
    # 모임 코드 형식이 아니면 limiter 를 세지 않는다(전역 코드 오타는 기존 403)
    assert _signup(client, "l31@example.com", "틀린코드").status_code == 403


class _SpyVerifier:
    def __init__(self, result: bool) -> None:
        self.result = result
        self.calls: list[str] = []

    async def is_valid(self, code: str) -> bool:
        self.calls.append(code)
        return self.result


async def test_check_invite_code_gate_off_ignores_verifier(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "hoondok_invite_code", None)
    spy = _SpyVerifier(False)
    await check_invite_code("아무거나", spy)
    await check_invite_code(None, spy)
    assert spy.calls == []

    monkeypatch.setattr(settings, "hoondok_invite_code", SecretStr("새벽-2026"))
    await check_invite_code(" 새벽-2026 ", spy)
    assert spy.calls == []  # 전역 코드 일치면 묻지 않는다
    with pytest.raises(InviteRequiredError):
        await check_invite_code("   ", spy)
    assert spy.calls == []
    with pytest.raises(InviteRequiredError):
        await check_invite_code("abcd-efgh", spy)
    assert spy.calls == ["abcd-efgh"]
    await check_invite_code("abcd-efgh", _SpyVerifier(True))
