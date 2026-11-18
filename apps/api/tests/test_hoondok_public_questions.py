"""공개 질문 (DEC-PWA-025) — 로그인 필수·위기 답 409·검수 전 비노출·본인 삭제·admin 승인·중복 신청."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.core.config import settings
from app.main import app
from app.modules.admin.dependencies import get_admin_service, get_current_admin
from app.modules.admin.models import AdminAuditLog
from app.modules.admin.repository import AdminRepository
from app.modules.admin.service import AdminService
from app.modules.chat.models import AnswerCitation, MessageRole, ResearchSession, SessionMessage
from app.modules.hoondok.dependencies import get_public_question_admin_service, get_public_question_service
from app.modules.hoondok.models import (
    PublicQuestion,
    PublicQuestionAsk,
    PublicQuestionBookmark,
    PublicQuestionView,
)
from app.modules.hoondok.ask.public_questions_repository import PublicQuestionRepository
from app.modules.hoondok.ask.public_questions_service import (
    PublicQuestionAdminService,
    PublicQuestionService,
    make_preview,
)
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.service import IdentityService

XHR = {"X-Requested-With": "XMLHttpRequest"}
BASE = datetime(2026, 11, 1, tzinfo=timezone.utc)


@pytest.fixture
async def ctx():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[
                User.__table__,
                ResearchSession.__table__,
                SessionMessage.__table__,
                AnswerCitation.__table__,
                PublicQuestion.__table__,
                PublicQuestionView.__table__,
                PublicQuestionAsk.__table__,
                PublicQuestionBookmark.__table__,
                AdminAuditLog.__table__,
            ],
        )
    session = AsyncSession(engine, expire_on_commit=False)
    repo = PublicQuestionRepository(session)
    users = UserRepository(session)
    app.dependency_overrides[get_public_question_service] = lambda: PublicQuestionService(repo)
    app.dependency_overrides[get_public_question_admin_service] = lambda: PublicQuestionAdminService(repo)
    app.dependency_overrides[get_identity_repository] = lambda: users
    app.dependency_overrides[get_admin_service] = lambda: AdminService(AdminRepository(session))
    app.dependency_overrides[get_current_admin] = lambda: {
        "user_id": uuid.uuid4(),
        "email": settings.demo_admin_email,
    }
    client = TestClient(app)
    client.session = session  # type: ignore[attr-defined]
    client.users = users  # type: ignore[attr-defined]
    try:
        yield client
    finally:
        for provider in (
            get_public_question_service,
            get_public_question_admin_service,
            get_identity_repository,
            get_admin_service,
            get_current_admin,
        ):
            app.dependency_overrides.pop(provider, None)
        await session.close()
        await engine.dispose()


async def login(client: TestClient, email: str = "reader@example.com") -> User:
    # 가입 API 는 닫혔다 — 저장소에 직접 만들고 issue_token 쿠키를 건다.
    user = await client.users.create(User(email=email, display_name="식구"))  # type: ignore[attr-defined]
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(user))
    client.me = user  # type: ignore[attr-defined]
    return user


async def add_answer(
    client: TestClient,
    *,
    question: str = "참사랑이란 무엇인가요?",
    answer: str = "### 짧게 말하면\n**참사랑**은 위하여 사는 사랑입니다.",
    mode: str | None = "standard",
    overridden: bool | None = False,
    trigger: str | None = None,
    minutes: int = 0,
    owner: uuid.UUID | None | bool = True,
) -> uuid.UUID:
    """세션 하나에 사용자 질문 → 답(+인용 2건)을 넣고 답 message_id 를 돌려준다.

    세션 소유자는 기본으로 마지막에 로그인한 사용자다(owner=True). None 이면 익명 세션.
    """
    session: AsyncSession = client.session  # type: ignore[attr-defined]
    if owner is True:
        owner = client.me.id  # type: ignore[attr-defined]
    chat = ResearchSession(user_id=owner)
    session.add(chat)
    await session.flush()
    at = BASE + timedelta(minutes=minutes)
    # 앞선 다른 질문 — 직전 질문만 복사되는지 확인용
    session.add(SessionMessage(session_id=chat.id, role=MessageRole.USER, content="앞선 질문", created_at=at - timedelta(seconds=10)))
    session.add(SessionMessage(session_id=chat.id, role=MessageRole.USER, content=question, created_at=at))
    reply = SessionMessage(
        session_id=chat.id,
        role=MessageRole.ASSISTANT,
        content=answer,
        created_at=at + timedelta(seconds=1),
        resolved_answer_mode=mode,
        persona_overridden=overridden,
        crisis_trigger=trigger,
    )
    session.add(reply)
    await session.flush()
    for rank in (1, 0):
        session.add(
            AnswerCitation(
                message_id=reply.id,
                source="A",
                volume=1,
                volume_raw=f"말씀선집 00{rank + 1}권",
                text_snippet=f"근거 {rank}",
                rank_position=rank,
            )
        )
    await session.commit()
    return reply.id


def submit(client: TestClient, message_id: uuid.UUID):
    return client.post("/hoondok/me/questions", json={"message_id": str(message_id)}, headers=XHR)


def publish(client: TestClient, question_id: str):
    return client.patch(f"/admin/hoondok/questions/{question_id}", json={"status": "published"}, headers=XHR)


# --- 신청 ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_requires_login_and_csrf(ctx: TestClient):
    user = await login(ctx)
    message_id = await add_answer(ctx)
    ctx.cookies.clear()
    assert submit(ctx, message_id).status_code == 401
    ctx.cookies.set(COOKIE_NAME, IdentityService.issue_token(user))
    res = ctx.post("/hoondok/me/questions", json={"message_id": str(message_id)})
    assert res.status_code == 403  # CSRF 헤더 없음
    assert ctx.get("/hoondok/me/questions").status_code == 200


@pytest.mark.asyncio
async def test_submit_copies_server_record_as_pending(ctx: TestClient):
    await login(ctx)
    message_id = await add_answer(ctx)
    res = ctx.post(
        "/hoondok/me/questions",
        json={"message_id": str(message_id)},
        headers=XHR,
    )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "pending" and body["question"] == "참사랑이란 무엇인가요?"
    assert body["answer_mode"] == "standard" and body["message_id"] == str(message_id)
    assert len(body["id"]) == 12  # 짧은 slug (UUID 아님)
    row = (await ctx.session.execute(select(PublicQuestion))).scalar_one()  # type: ignore[attr-defined]
    assert row.answer_md.startswith("### 짧게 말하면")
    assert [s["text"] for s in row.sources] == ["근거 0", "근거 1"]  # rank 순 복사


@pytest.mark.asyncio
async def test_submit_rejects_client_supplied_text(ctx: TestClient):
    await login(ctx)
    message_id = await add_answer(ctx)
    res = ctx.post(
        "/hoondok/me/questions",
        json={"message_id": str(message_id), "question": "조작된 질문"},
        headers=XHR,
    )
    assert res.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mode", "overridden", "trigger"),
    [
        ("pastoral", False, None),
        ("pastoral", False, "emotional"),
        ("pastoral", True, "intent:crisis"),
        ("standard", True, None),
        ("standard", False, "죽고 싶"),
        (None, None, None),  # 모드 기록 없는 답(메타 안내·옛 기록)
    ],
)
async def test_submit_pastoral_or_crisis_answer_is_409(ctx: TestClient, mode, overridden, trigger):
    await login(ctx)
    message_id = await add_answer(ctx, mode=mode, overridden=overridden, trigger=trigger)
    assert submit(ctx, message_id).status_code == 409
    assert (await ctx.session.execute(select(PublicQuestion))).first() is None  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_submit_unknown_or_user_message_is_404(ctx: TestClient):
    await login(ctx)
    await add_answer(ctx)
    assert submit(ctx, uuid.uuid4()).status_code == 404
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    user_msg = (
        await session.execute(select(SessionMessage).where(SessionMessage.role == MessageRole.USER))
    ).scalars().first()
    assert submit(ctx, user_msg.id).status_code == 404  # 질문 메시지는 공개 대상이 아니다


@pytest.mark.asyncio
async def test_duplicate_message_returns_own_or_409(ctx: TestClient):
    await login(ctx)
    message_id = await add_answer(ctx)
    first = submit(ctx, message_id)
    assert first.status_code == 201
    # 본인 재신청(응답 유실 뒤 다시 신청)은 기존 신청을 돌려준다 — 기기가 publicId 를 되찾는다.
    again = submit(ctx, message_id)
    assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
    await login(ctx, "other@example.com")
    assert submit(ctx, message_id).status_code == 404  # 남의 답은 세션 소유자가 아니라 없는 답과 같다
    assert len((await ctx.session.execute(select(PublicQuestion))).all()) == 1  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_answer_without_citations_is_409(ctx: TestClient):
    """캐시 적중 답처럼 인용 기록이 없는 답은 근거 없이 공개되지 않는다."""
    await login(ctx)
    message_id = await add_answer(ctx)
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    for c in (await session.execute(select(AnswerCitation))).scalars().all():
        await session.delete(c)
    await session.commit()
    assert submit(ctx, message_id).status_code == 409


@pytest.mark.asyncio
async def test_follow_up_answer_is_409(ctx: TestClient):
    """이어 물은 답은 앞 턴의 사연을 이어받을 수 있어 공개하지 않는다 — 세션 첫 답만."""
    await login(ctx)
    first_id = await add_answer(ctx)
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    first = await session.get(SessionMessage, first_id)
    at = first.created_at + timedelta(minutes=1)
    session.add(SessionMessage(session_id=first.session_id, role=MessageRole.USER, content="그럼 그건요?", created_at=at))
    follow = SessionMessage(
        session_id=first.session_id,
        role=MessageRole.ASSISTANT,
        content="이어진 답",
        created_at=at + timedelta(seconds=1),
        resolved_answer_mode="standard",
        persona_overridden=False,
    )
    session.add(follow)
    await session.flush()
    session.add(AnswerCitation(message_id=follow.id, source="A", volume=1, volume_raw="말씀선집 001권", text_snippet="근거", rank_position=0))
    await session.commit()
    assert submit(ctx, follow.id).status_code == 409
    assert submit(ctx, first_id).status_code == 201


@pytest.mark.asyncio
async def test_submit_requires_session_owner(ctx: TestClient):
    """message_id 를 알아도 세션 소유자가 아니면 404 — 익명(시연 챗) 세션 답·남의 답 모두."""
    owner = await login(ctx, "owner@example.com")
    owned = await add_answer(ctx)
    anonymous = await add_answer(ctx, owner=None, minutes=1)
    assert submit(ctx, anonymous).status_code == 404
    await login(ctx, "other@example.com")
    assert submit(ctx, owned).status_code == 404
    ctx.cookies.set(COOKIE_NAME, IdentityService.issue_token(owner))
    assert submit(ctx, owned).status_code == 201
    assert len((await ctx.session.execute(select(PublicQuestion))).all()) == 1  # type: ignore[attr-defined]


# --- 공개 범위 ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pending_and_hidden_are_not_public(ctx: TestClient):
    await login(ctx)
    pending_id = submit(ctx, await add_answer(ctx)).json()["id"]
    hidden_id = submit(ctx, await add_answer(ctx, minutes=1)).json()["id"]
    assert ctx.patch(f"/admin/hoondok/questions/{hidden_id}", json={"status": "hidden"}, headers=XHR).status_code == 200

    assert ctx.get("/hoondok/questions").json() == {"items": [], "next_cursor": None}
    assert ctx.get(f"/hoondok/questions/{pending_id}").status_code == 404
    assert ctx.get(f"/hoondok/questions/{hidden_id}").status_code == 404
    assert ctx.get("/hoondok/questions/nope").status_code == 404


@pytest.mark.asyncio
async def test_admin_publish_makes_it_public_without_author(ctx: TestClient):
    await login(ctx)
    qid = submit(ctx, await add_answer(ctx)).json()["id"]

    queue = ctx.get("/admin/hoondok/questions?status=pending").json()
    assert queue["total"] == 1 and queue["items"][0]["id"] == qid
    assert "user_id" not in queue["items"][0]

    reviewed = publish(ctx, qid)
    assert reviewed.status_code == 200 and reviewed.json()["status"] == "published"
    assert reviewed.json()["reviewed_at"] is not None
    audit = (await ctx.session.execute(select(AdminAuditLog))).scalars().all()  # type: ignore[attr-defined]
    assert [a.action for a in audit] == ["public_question.review"]

    listed = ctx.get("/hoondok/questions").json()
    assert [i["id"] for i in listed["items"]] == [qid]
    item = listed["items"][0]
    assert set(item) == {
        "id", "question", "preview", "answer_mode", "published_at", "pinned", "view_count", "bookmarked",
    }
    assert item["pinned"] is False and item["view_count"] == 0 and item["bookmarked"] is False
    assert item["preview"].startswith("짧게 말하면 참사랑은")  # 마크다운 기호 제거

    detail = ctx.get(f"/hoondok/questions/{qid}").json()
    assert set(detail) == {"id", "question", "answer_md", "sources", "answer_mode", "published_at", "bookmarked"}
    assert detail["sources"][0] == {"source": "A", "volume": "말씀선집 001권", "text": "근거 0"}

    me = ctx.get("/hoondok/me/questions").json()["items"]
    assert me[0]["status"] == "published"


@pytest.mark.asyncio
async def test_admin_patch_rejects_other_values(ctx: TestClient):
    await login(ctx)
    qid = submit(ctx, await add_answer(ctx)).json()["id"]
    assert ctx.patch(f"/admin/hoondok/questions/{qid}", json={"status": "pending"}, headers=XHR).status_code == 422
    assert ctx.patch(f"/admin/hoondok/questions/{qid}", json={"status": "published", "question": "x"}, headers=XHR).status_code == 422
    assert publish(ctx, "missing").status_code == 404


@pytest.mark.asyncio
async def test_public_list_search_and_cursor(ctx: TestClient):
    await login(ctx)
    ids = []
    for n, text in enumerate(["참사랑이란?", "축복의 의미는?", "참부모님은 누구인가요?"]):
        qid = submit(ctx, await add_answer(ctx, question=text, minutes=n)).json()["id"]
        publish(ctx, qid)
        ids.append(qid)

    first = ctx.get("/hoondok/questions?limit=2").json()
    assert len(first["items"]) == 2 and first["next_cursor"] == "2"
    second = ctx.get(f"/hoondok/questions?limit=2&cursor={first['next_cursor']}").json()
    assert len(second["items"]) == 1 and second["next_cursor"] is None
    all_ids = [i["id"] for i in first["items"] + second["items"]]
    assert sorted(all_ids) == sorted(ids) and len(set(all_ids)) == 3
    assert all_ids[0] == ids[-1]  # 마지막에 공개한 것이 맨 앞

    found = ctx.get("/hoondok/questions", params={"q": "참"}).json()["items"]
    assert {i["question"] for i in found} == {"참사랑이란?", "참부모님은 누구인가요?"}
    assert ctx.get("/hoondok/questions", params={"q": "%"}).json()["items"] == []  # 와일드카드는 글자 그대로
    assert ctx.get("/hoondok/questions?cursor=nope").status_code == 422


# --- 삭제 ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_delete_hides_immediately_and_others_cannot(ctx: TestClient):
    owner = await login(ctx, "owner@example.com")
    qid = submit(ctx, await add_answer(ctx)).json()["id"]
    publish(ctx, qid)
    assert ctx.get(f"/hoondok/questions/{qid}").status_code == 200

    await login(ctx, "other@example.com")
    assert ctx.delete(f"/hoondok/me/questions/{qid}", headers=XHR).status_code == 404
    assert ctx.get("/hoondok/me/questions").json() == {"items": []}  # 남의 신청은 내 목록에 없다

    ctx.cookies.set(COOKIE_NAME, IdentityService.issue_token(owner))
    assert ctx.delete(f"/hoondok/me/questions/{qid}").status_code == 403  # CSRF
    assert ctx.delete(f"/hoondok/me/questions/{qid}", headers=XHR).status_code == 204
    assert ctx.get(f"/hoondok/questions/{qid}").status_code == 404
    assert publish(ctx, qid).status_code == 404  # 관리자도 되살릴 수 없다


@pytest.mark.asyncio
async def test_delete_for_user_purges_rows(ctx: TestClient):
    owner = await login(ctx)
    submit(ctx, await add_answer(ctx))
    repo = PublicQuestionRepository(ctx.session)  # type: ignore[attr-defined]
    await repo.delete_for_user(owner.id)
    await ctx.session.commit()  # type: ignore[attr-defined]
    assert (await ctx.session.execute(select(PublicQuestion))).first() is None  # type: ignore[attr-defined]


def test_make_preview_strips_markdown_and_truncates():
    assert make_preview("## 제목\n**굵게** _기울임_") == "제목 굵게 기울임"
    long = make_preview("가" * 200)
    assert long.endswith("…") and len(long) == 121


# --- 인기도·고정·목록 순서 ---------------------------------------------------------


async def make_published(ctx: TestClient, text: str, minutes: int = 0) -> str:
    qid = submit(ctx, await add_answer(ctx, question=text, minutes=minutes)).json()["id"]
    assert publish(ctx, qid).status_code == 200
    return qid


async def set_counts(ctx: TestClient, qid: str, *, views: int = 0, asks: int = 0) -> None:
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    row = await session.get(PublicQuestion, qid)
    row.view_count, row.ask_count = views, asks  # type: ignore[union-attr]
    await session.commit()


def public_ids(ctx: TestClient, **params) -> list[str]:
    return [i["id"] for i in ctx.get("/hoondok/questions", params=params).json()["items"]]


def pin(ctx: TestClient, qid: str, pinned: bool = True):
    return ctx.patch(f"/admin/hoondok/questions/{qid}", json={"pinned": pinned}, headers=XHR)


@pytest.mark.asyncio
async def test_public_order_pinned_then_popularity_then_recency(ctx: TestClient):
    await login(ctx)
    old = await make_published(ctx, "가", 0)
    mid = await make_published(ctx, "나", 1)
    new = await make_published(ctx, "다", 2)
    hot = await make_published(ctx, "라", 3)
    tie = await make_published(ctx, "마", 4)
    await set_counts(ctx, hot, views=1, asks=2)  # 점수 7
    await set_counts(ctx, old, views=5)  # 점수 5
    await set_counts(ctx, mid, asks=1)  # 점수 3
    # 점수 0 인 new·tie 는 최근 공개순 (tie 가 나중에 공개)
    assert public_ids(ctx) == [hot, old, mid, tie, new]
    assert pin(ctx, new).status_code == 200  # 고정은 점수와 무관하게 맨 앞
    assert pin(ctx, old).status_code == 200
    assert public_ids(ctx) == [new, old, hot, mid, tie]
    items = ctx.get("/hoondok/questions").json()["items"]
    assert [i["pinned"] for i in items] == [True, True, False, False, False]
    assert items[1]["view_count"] == 5


@pytest.mark.asyncio
async def test_cursor_paging_has_no_gaps(ctx: TestClient):
    await login(ctx)
    ids = [await make_published(ctx, f"질문 {n}", n) for n in range(7)]
    await set_counts(ctx, ids[2], views=9)
    pin(ctx, ids[5])
    expected = public_ids(ctx, limit=50)
    assert len(expected) == 7
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        params = {"limit": 3, **({"cursor": cursor} if cursor else {})}
        body = ctx.get("/hoondok/questions", params=params).json()
        seen += [i["id"] for i in body["items"]]
        pages += 1
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert seen == expected and pages == 3
    for bad in ("abc", "-1", "1.5", "１"):
        assert ctx.get("/hoondok/questions", params={"cursor": bad}).status_code == 422


# --- 조회 기록 ---------------------------------------------------------------------


def view(ctx: TestClient, qid: str, viewer_id=None, headers=XHR):
    body = {"viewer_id": str(viewer_id)} if viewer_id else {}
    return ctx.post(f"/hoondok/questions/{qid}/views", json=body, headers=headers)


async def views_of(ctx: TestClient, qid: str) -> int:
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    session.expire_all()
    return (await session.get(PublicQuestion, qid)).view_count  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_view_counts_once_per_viewer_per_day(ctx: TestClient):
    await login(ctx)
    qid = await make_published(ctx, "조회")
    ctx.cookies.clear()
    anon = uuid.uuid4()
    assert view(ctx, qid, anon).status_code == 204
    assert view(ctx, qid, anon).status_code == 204
    assert await views_of(ctx, qid) == 1
    assert view(ctx, qid, uuid.uuid4()).status_code == 204  # 다른 익명
    assert await views_of(ctx, qid) == 2
    assert view(ctx, qid).status_code == 204  # 식별자 없음 → 세지 않는다
    assert await views_of(ctx, qid) == 2

    user = await login(ctx, "viewer@example.com")
    user_id = str(user.id)
    assert view(ctx, qid, anon).status_code == 204  # 로그인 계정이 우선 — 익명과 별개로 1
    assert view(ctx, qid, uuid.uuid4()).status_code == 204  # viewer_id 가 달라도 같은 계정
    assert await views_of(ctx, qid) == 3
    rows = (await ctx.session.execute(select(PublicQuestionView))).scalars().all()  # type: ignore[attr-defined]
    assert all(len(r.viewer_key) == 64 and user_id not in r.viewer_key for r in rows)
    assert str(anon) not in {r.viewer_key for r in rows}


@pytest.mark.asyncio
async def test_view_counts_again_next_day_and_prunes_old_rows(ctx: TestClient):
    from datetime import date

    await login(ctx)
    qid = await make_published(ctx, "조회")
    repo = PublicQuestionRepository(ctx.session)  # type: ignore[attr-defined]
    day = date(2026, 11, 10)
    assert await repo.record_view(qid, "k" * 64, day - timedelta(days=3))
    assert await repo.record_view(qid, "k" * 64, day - timedelta(days=2))
    assert await repo.record_view(qid, "k" * 64, day)  # 다음 날은 다시 센다
    assert not await repo.record_view(qid, "k" * 64, day)
    days = {r.day for r in (await ctx.session.execute(select(PublicQuestionView))).scalars().all()}  # type: ignore[attr-defined]
    assert days == {day - timedelta(days=2), day}  # 오늘 - 2일 미만은 지워진다


@pytest.mark.asyncio
async def test_view_404_and_csrf(ctx: TestClient):
    await login(ctx)
    pending = submit(ctx, await add_answer(ctx)).json()["id"]
    hidden = await make_published(ctx, "숨김", 1)
    ctx.patch(f"/admin/hoondok/questions/{hidden}", json={"status": "hidden"}, headers=XHR)
    published = await make_published(ctx, "공개", 2)
    ctx.cookies.clear()
    anon = uuid.uuid4()
    for qid in (pending, hidden, "missing"):
        assert view(ctx, qid, anon).status_code == 404
    assert view(ctx, published, anon, headers={}).status_code == 403
    assert ctx.post(f"/hoondok/questions/{published}/views", json={"x": 1}, headers=XHR).status_code == 422
    assert await views_of(ctx, published) == 0


# --- 북마크 ------------------------------------------------------------------------


def bookmark(ctx: TestClient, qid: str, method: str = "put", headers=XHR):
    return ctx.request(method, f"/hoondok/questions/{qid}/bookmark", headers=headers)


@pytest.mark.asyncio
async def test_bookmark_is_idempotent_and_listed_newest_first(ctx: TestClient):
    await login(ctx)
    first = await make_published(ctx, "첫째", 0)
    second = await make_published(ctx, "둘째", 1)
    assert bookmark(ctx, first).status_code == 204
    assert bookmark(ctx, first).status_code == 204  # 멱등
    assert bookmark(ctx, second).status_code == 204
    assert len((await ctx.session.execute(select(PublicQuestionBookmark))).all()) == 2  # type: ignore[attr-defined]
    listed = ctx.get("/hoondok/me/question-bookmarks").json()["items"]
    assert [i["id"] for i in listed] == [second, first]
    assert all(i["bookmarked"] for i in listed)
    assert bookmark(ctx, first, "delete").status_code == 204
    assert bookmark(ctx, first, "delete").status_code == 204  # 멱등
    assert bookmark(ctx, "missing", "delete").status_code == 204
    assert [i["id"] for i in ctx.get("/hoondok/me/question-bookmarks?limit=1").json()["items"]] == [second]
    assert ctx.get("/hoondok/me/question-bookmarks?limit=101").status_code == 422
    # 인기도에는 영향이 없다
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    session.expire_all()
    row = await session.get(PublicQuestion, second)
    assert (row.view_count, row.ask_count) == (0, 0)  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_bookmark_requires_login_csrf_and_published(ctx: TestClient):
    await login(ctx)
    pending = submit(ctx, await add_answer(ctx)).json()["id"]
    live = await make_published(ctx, "공개", 1)
    assert bookmark(ctx, pending).status_code == 404
    assert bookmark(ctx, "missing").status_code == 404
    assert bookmark(ctx, live, headers={}).status_code == 403
    assert bookmark(ctx, live, "delete", headers={}).status_code == 403
    assert bookmark(ctx, live).status_code == 204
    ctx.cookies.clear()
    assert bookmark(ctx, live).status_code == 401
    assert bookmark(ctx, live, "delete").status_code == 401
    assert ctx.get("/hoondok/me/question-bookmarks").status_code == 401


@pytest.mark.asyncio
async def test_bookmark_list_drops_unpublished_and_stale_can_be_removed(ctx: TestClient):
    await login(ctx)
    qid = await make_published(ctx, "공개")
    assert bookmark(ctx, qid).status_code == 204
    ctx.patch(f"/admin/hoondok/questions/{qid}", json={"status": "hidden"}, headers=XHR)
    assert ctx.get("/hoondok/me/question-bookmarks").json() == {"items": []}
    assert bookmark(ctx, qid).status_code == 404
    assert bookmark(ctx, qid, "delete").status_code == 204  # 내려간 뒤에도 해제 가능
    assert (await ctx.session.execute(select(PublicQuestionBookmark))).first() is None  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_bookmarked_flag_is_per_user(ctx: TestClient):
    owner = await login(ctx, "owner@example.com")
    qid = await make_published(ctx, "공개")
    other_qid = await make_published(ctx, "다른", 1)
    assert bookmark(ctx, qid).status_code == 204
    flags = {i["id"]: i["bookmarked"] for i in ctx.get("/hoondok/questions").json()["items"]}
    assert flags == {qid: True, other_qid: False}
    assert ctx.get(f"/hoondok/questions/{qid}").json()["bookmarked"] is True
    assert ctx.get(f"/hoondok/questions/{other_qid}").json()["bookmarked"] is False

    await login(ctx, "other@example.com")
    assert not any(i["bookmarked"] for i in ctx.get("/hoondok/questions").json()["items"])
    assert ctx.get(f"/hoondok/questions/{qid}").json()["bookmarked"] is False
    ctx.cookies.clear()
    assert not any(i["bookmarked"] for i in ctx.get("/hoondok/questions").json()["items"])
    assert ctx.get(f"/hoondok/questions/{qid}").json()["bookmarked"] is False
    assert owner.id


# --- 삭제 시 자식 행 -----------------------------------------------------------------


async def add_children(ctx: TestClient, qid: str, user: User) -> None:
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    from app.modules.hoondok.ask.public_questions_repository import viewer_key

    repo = PublicQuestionRepository(session)
    await repo.record_view(qid, viewer_key("u", user.id), BASE.date())
    await repo.record_ask(qid, user.id)
    await repo.add_bookmark(qid, user.id)


async def child_rows(ctx: TestClient) -> int:
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    total = 0
    for model in (PublicQuestionView, PublicQuestionAsk, PublicQuestionBookmark):
        total += len((await session.execute(select(model))).all())
    return total


@pytest.mark.asyncio
async def test_withdraw_deletes_child_rows(ctx: TestClient):
    owner = await login(ctx, "owner@example.com")
    qid = await make_published(ctx, "공개")
    reader = await ctx.users.create(User(email="reader2@example.com", display_name="독자"))  # type: ignore[attr-defined]
    await add_children(ctx, qid, reader)
    assert await child_rows(ctx) == 3
    ctx.cookies.set(COOKIE_NAME, IdentityService.issue_token(owner))
    assert ctx.delete(f"/hoondok/me/questions/{qid}", headers=XHR).status_code == 204
    assert await child_rows(ctx) == 0


@pytest.mark.asyncio
async def test_account_purge_removes_children_of_own_and_others(ctx: TestClient):
    owner = await login(ctx, "owner@example.com")
    mine = await make_published(ctx, "내 질문")
    reader = await ctx.users.create(User(email="reader3@example.com", display_name="독자"))  # type: ignore[attr-defined]
    keeper = await ctx.users.create(User(email="keeper@example.com", display_name="유지"))  # type: ignore[attr-defined]
    # reader 가 owner 의 질문에, owner 가 reader 의 질문에 남긴 행
    await add_children(ctx, mine, reader)
    await add_children(ctx, mine, keeper)
    theirs = PublicQuestion(
        id="theirs000001", user_id=reader.id, message_id=uuid.uuid4(), question="q", answer_md="a",
        sources=[], answer_mode="standard", status="published",
    )
    ctx.session.add(theirs)  # type: ignore[attr-defined]
    await ctx.session.commit()  # type: ignore[attr-defined]
    await add_children(ctx, theirs.id, owner)

    repo = PublicQuestionRepository(ctx.session)  # type: ignore[attr-defined]
    await repo.delete_for_user(owner.id)  # owner 삭제: 내 질문과 그 자식, 내가 남긴 행
    await ctx.session.commit()  # type: ignore[attr-defined]
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    for model in (PublicQuestionView, PublicQuestionAsk, PublicQuestionBookmark):
        assert (await session.execute(select(model).where(model.question_id == mine))).first() is None
        assert (await session.execute(select(model).where(model.question_id == theirs.id))).first() is None

    await repo.delete_for_user(reader.id)  # reader 삭제 → 남은 자식 모두 제거
    await ctx.session.commit()  # type: ignore[attr-defined]
    assert await child_rows(ctx) == 0


# --- admin 고정·정렬 ----------------------------------------------------------------


def admin_get(ctx: TestClient, **params):
    return ctx.get("/admin/hoondok/questions", params=params).json()


@pytest.mark.asyncio
async def test_admin_pin_rules(ctx: TestClient):
    await login(ctx)
    pending = submit(ctx, await add_answer(ctx)).json()["id"]
    assert pin(ctx, pending).status_code == 409  # 공개 중이 아니면 고정 불가
    both = ctx.patch(f"/admin/hoondok/questions/{pending}", json={"status": "hidden", "pinned": True}, headers=XHR)
    assert both.status_code == 409
    publish_and_pin = ctx.patch(
        f"/admin/hoondok/questions/{pending}", json={"status": "published", "pinned": True}, headers=XHR
    )
    assert publish_and_pin.status_code == 200 and publish_and_pin.json()["pin_order"] == 0
    assert ctx.patch(f"/admin/hoondok/questions/{pending}", json={}, headers=XHR).status_code == 422
    assert ctx.patch(f"/admin/hoondok/questions/{pending}", json={"pinned": True, "x": 1}, headers=XHR).status_code == 422
    assert pin(ctx, "missing").status_code == 404

    ids = [pending] + [await make_published(ctx, f"고정 {n}", n + 1) for n in range(9)]
    for qid in ids[1:]:
        assert pin(ctx, qid).status_code == 200
    assert pin(ctx, ids[3]).json()["pin_order"] == 3  # 이미 고정 → 그대로
    extra = await make_published(ctx, "열한째", 20)
    assert pin(ctx, extra).status_code == 409  # 최대 10개
    assert [i["id"] for i in ctx.get("/admin/hoondok/questions/pins").json()["items"]] == ids


@pytest.mark.asyncio
async def test_admin_hide_unpins_and_unpin_renumbers(ctx: TestClient):
    await login(ctx)
    ids = [await make_published(ctx, f"질문 {n}", n) for n in range(4)]
    for qid in ids:
        pin(ctx, qid)
    hidden = ctx.patch(f"/admin/hoondok/questions/{ids[1]}", json={"status": "hidden"}, headers=XHR)
    assert hidden.json()["pin_order"] is None
    pins = ctx.get("/admin/hoondok/questions/pins").json()["items"]
    assert [(p["id"], p["pin_order"]) for p in pins] == [(ids[0], 0), (ids[2], 1), (ids[3], 2)]
    assert pin(ctx, ids[0], False).json()["pin_order"] is None
    pins = ctx.get("/admin/hoondok/questions/pins").json()["items"]
    assert [(p["id"], p["pin_order"]) for p in pins] == [(ids[2], 0), (ids[3], 1)]
    assert pin(ctx, ids[0], False).status_code == 200  # 이미 해제 → 그대로
    # 다시 공개해도 자동으로 고정되지 않는다
    ctx.patch(f"/admin/hoondok/questions/{ids[1]}", json={"status": "published"}, headers=XHR)
    assert ids[1] not in [p["id"] for p in ctx.get("/admin/hoondok/questions/pins").json()["items"]]
    assert pin(ctx, ids[1]).json()["pin_order"] == 2  # max + 1


@pytest.mark.asyncio
async def test_admin_reorder_pins(ctx: TestClient):
    await login(ctx)
    ids = [await make_published(ctx, f"질문 {n}", n) for n in range(3)]
    outsider = await make_published(ctx, "고정 안 함", 9)
    for qid in ids:
        pin(ctx, qid)

    def put(body):
        return ctx.put("/admin/hoondok/questions/pins", json=body, headers=XHR)

    for bad in (ids[:2], ids + [outsider], [ids[0], ids[0], ids[1]], ids[:2] + ["missing"]):
        assert put({"ids": bad}).status_code == 422
    assert put({"ids": ids, "x": 1}).status_code == 422
    assert put({"ids": [f"x{n}" for n in range(11)]}).status_code == 422
    assert ctx.put("/admin/hoondok/questions/pins", json={"ids": ids}).status_code == 403
    res = put({"ids": [ids[2], ids[0], ids[1]]})
    assert res.status_code == 200
    assert [(i["id"], i["pin_order"]) for i in res.json()["items"]] == [(ids[2], 0), (ids[0], 1), (ids[1], 2)]
    assert public_ids(ctx)[:3] == [ids[2], ids[0], ids[1]]
    audit = (await ctx.session.execute(select(AdminAuditLog).where(AdminAuditLog.action == "public_question.reorder_pins"))).scalars().all()  # type: ignore[attr-defined]
    assert len(audit) == 1 and audit[0].changes == {"ids": [ids[2], ids[0], ids[1]]}


@pytest.mark.asyncio
async def test_admin_pin_writes_audit_with_slug_and_changes(ctx: TestClient):
    await login(ctx)
    qid = await make_published(ctx, "감사")
    pin(ctx, qid)
    ctx.patch(f"/admin/hoondok/questions/{qid}", json={"status": "hidden"}, headers=XHR)
    audit = (await ctx.session.execute(select(AdminAuditLog).order_by(AdminAuditLog.created_at))).scalars().all()  # type: ignore[attr-defined]
    changes = [a.changes for a in audit]
    assert {"id": qid, "status": "published"} in changes
    assert {"id": qid, "pinned": True} in changes
    assert {"id": qid, "status": "hidden", "pinned": False} in changes


@pytest.mark.asyncio
async def test_admin_list_sort_and_search(ctx: TestClient):
    await login(ctx)
    a = await make_published(ctx, "참사랑 하나", 0)
    b = await make_published(ctx, "축복 둘", 1)
    c = await make_published(ctx, "참부모 셋", 2)
    await set_counts(ctx, a, views=1)
    await set_counts(ctx, b, asks=1)  # 점수 3
    assert [i["id"] for i in admin_get(ctx)["items"]] == [a, b, c]  # 기본 oldest
    assert [i["id"] for i in admin_get(ctx, sort="newest")["items"]] == [c, b, a]
    popular = admin_get(ctx, sort="popular")["items"]
    assert [i["id"] for i in popular] == [b, a, c]
    assert (popular[0]["view_count"], popular[0]["ask_count"], popular[0]["score"]) == (0, 1, 3)
    assert popular[0]["pin_order"] is None and "user_id" not in popular[0]
    found = admin_get(ctx, q="참")
    assert {i["id"] for i in found["items"]} == {a, c} and found["total"] == 2
    assert admin_get(ctx, q="%")["items"] == []
    assert ctx.get("/admin/hoondok/questions", params={"sort": "bogus"}).status_code == 422
    assert ctx.get("/admin/hoondok/questions", params={"q": "x" * 101}).status_code == 422
