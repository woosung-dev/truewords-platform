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
from app.modules.hoondok.models import PublicQuestion
from app.modules.hoondok.public_questions_repository import PublicQuestionRepository
from app.modules.hoondok.public_questions_service import (
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
    assert set(item) == {"id", "question", "preview", "answer_mode", "published_at"}
    assert item["preview"].startswith("짧게 말하면 참사랑은")  # 마크다운 기호 제거

    detail = ctx.get(f"/hoondok/questions/{qid}").json()
    assert set(detail) == {"id", "question", "answer_md", "sources", "answer_mode", "published_at"}
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
    assert len(first["items"]) == 2 and first["next_cursor"] == first["items"][-1]["id"]
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
