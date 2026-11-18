"""훈독 AI 질문 (DEC-PWA-025 2차) — 로그인 필수·하루 5회·실패 시 차감 취소·KST 경계·동시성·소유권·계정 보관·삭제.

채팅 파이프라인은 입력 검증·세션 단계(소유 확인)만 실제 코드로 돌리고, 검색·LLM 대신 고정 답을 쓰는 가짜로 바꾼다.
"""

import asyncio
import json
import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.core.config import settings
from app.main import app
from app.modules.chat.exceptions import SessionOwnershipError
from app.modules.chat.models import (
    AnswerCitation,
    AnswerFeedback,
    MessageReaction,
    MessageRole,
    ResearchSession,
    SearchEvent,
    SessionMessage,
)
from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.repository import ChatRepository
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.service import ChatService
from app.modules.hoondok.asks_repository import AskRepository
from app.modules.hoondok.asks_service import AskService, next_reset
from app.modules.hoondok.dependencies import get_ask_chat_service, get_ask_repository, get_public_question_repository
from app.modules.hoondok.public_questions_repository import PublicQuestionRepository
from app.modules.hoondok.models import AskThread, AskTurn, AskUsage, ContentRight, PublicQuestion
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.service import IdentityService
from app.modules.safety.rate_limiter import get_rate_limiter

XHR = {"X-Requested-With": "XMLHttpRequest"}
TABLES = [
    User,
    ResearchSession,
    SessionMessage,
    SearchEvent,
    AnswerCitation,
    AnswerFeedback,
    MessageReaction,
    PublicQuestion,
    AskThread,
    AskTurn,
    AskUsage,
    ContentRight,
]


class FakeChatService(ChatService):
    """입력 검증·세션 단계는 실제로 돌리고, 그 뒤는 고정 답(인용 1건)을 기록해 SSE 로 흘린다."""

    fail_after_session: Exception | None = None
    volume_filter: list[str] | None = None

    async def process_chat_stream(
        self, request: ChatRequest, user_id: uuid.UUID | None = None, volume_filter: list[str] | None = None
    ):
        self.volume_filter = volume_filter
        ctx = await self.input_validation_stage.execute(ChatContext(request=request, user_id=user_id))
        ctx = await self.session_stage.execute(ctx)
        if self.fail_after_session is not None:
            raise self.fail_after_session
        assert ctx.session is not None
        answer = f"{request.query}에 대한 답"
        mode = request.answer_mode or "standard"
        message = await self.chat_repo.create_message(
            SessionMessage(
                session_id=ctx.session.id,
                role=MessageRole.ASSISTANT,
                content=answer,
                pipeline_version=2,
                resolved_answer_mode=mode,
                persona_overridden=False,
            )
        )
        await self.chat_repo.create_citations(
            [AnswerCitation(message_id=message.id, source="A", volume=1, volume_raw="001권", text_snippet="근거")]
        )
        await self.chat_repo.commit()
        sources = {
            "sources": [
                {"volume": "001권", "text": "근거", "score": 0.9, "source": "A", "chunk_id": "chunk-1", "display_name": "말씀선집 1권"}
            ],
            "session_id": str(ctx.session.id),
            "message_id": str(message.id),
            "closing": None,
            "suggested_followups": ["다음 질문"],
            "featured_malssum": None,
            "answer_mode": mode,
        }
        yield f"event: chunk\ndata: {json.dumps({'text': answer}, ensure_ascii=False)}\n\n"
        yield f"event: sources\ndata: {json.dumps(sources, ensure_ascii=False)}\n\n"
        yield f"event: done\ndata: {json.dumps({'disclaimer': '안내'}, ensure_ascii=False)}\n\n"


@pytest.fixture
async def ctx():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[t.__table__ for t in TABLES])
    session = AsyncSession(engine, expire_on_commit=False)
    chatbots = MagicMock()
    chatbots.get_config_id = AsyncMock(return_value=None)
    chatbots.build_runtime_config = AsyncMock(return_value=None)
    chat = FakeChatService(chat_repo=ChatRepository(session), chatbot_service=chatbots)
    users = UserRepository(session)
    app.dependency_overrides[get_ask_chat_service] = lambda: chat
    app.dependency_overrides[get_ask_repository] = lambda: AskRepository(session)
    app.dependency_overrides[get_public_question_repository] = lambda: PublicQuestionRepository(session)
    app.dependency_overrides[get_identity_repository] = lambda: users
    get_rate_limiter().reset()
    client = TestClient(app)
    client.session = session  # type: ignore[attr-defined]
    client.users = users  # type: ignore[attr-defined]
    client.chat = chat  # type: ignore[attr-defined]
    try:
        yield client
    finally:
        for provider in (get_ask_chat_service, get_ask_repository, get_public_question_repository, get_identity_repository):
            app.dependency_overrides.pop(provider, None)
        await session.close()
        await engine.dispose()


async def login(client: TestClient, email: str = "reader@example.com") -> User:
    from app.modules.identity.schemas import SignupRequest

    user = await IdentityService(client.users).signup(  # type: ignore[attr-defined]
        SignupRequest(email=email, password="password1", display_name="식구")
    )
    use(client, user)
    return user


def use(client: TestClient, user: User) -> None:
    client.cookies.clear()
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(user))


def ask(client: TestClient, query: str = "참사랑이란?", **extra):
    return client.post("/hoondok/ask/stream", json={"query": query, **extra}, headers=XHR)


def sources_of(res) -> dict:
    """SSE 본문에서 sources 이벤트 데이터."""
    for block in res.text.split("\n\n"):
        if block.startswith("event: sources\n"):
            return json.loads(block.split("\ndata: ", 1)[1])
    raise AssertionError(f"sources 이벤트 없음: {res.text!r}")


def quota(client: TestClient) -> dict:
    return client.get("/hoondok/me/asks/quota").json()


# --- 로그인 ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ask_requires_login_and_csrf(ctx: TestClient):
    assert ask(ctx).status_code == 401
    assert ctx.get("/hoondok/me/asks").status_code == 401
    assert ctx.get("/hoondok/me/asks/quota").status_code == 401
    await login(ctx)
    assert ctx.post("/hoondok/ask/stream", json={"query": "참사랑이란?"}).status_code == 403  # CSRF
    # 시연 챗 admin_token 쿠키로는 훈독 질문을 할 수 없다
    ctx.cookies.clear()
    ctx.cookies.set("admin_token", IdentityService.issue_token(await ctx.users.get_by_email("reader@example.com")))  # type: ignore[attr-defined]
    assert ask(ctx).status_code == 401


@pytest.mark.asyncio
async def test_ask_streams_same_event_contract_and_records_turn(ctx: TestClient):
    user = await login(ctx)
    res = ask(ctx, answer_mode="beginner")
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    events = [block.split("\n", 1)[0] for block in res.text.strip().split("\n\n")]
    assert events == ["event: chunk", "event: sources", "event: done"]
    data = sources_of(res)
    assert data["answer_mode"] == "beginner"
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    chat_session = await session.get(ResearchSession, uuid.UUID(data["session_id"]))
    assert chat_session.user_id == user.id  # 세션은 훈독 계정에 묶인다
    turn = await session.get(AskTurn, uuid.UUID(data["message_id"]))
    assert turn.sources[0]["chunk_id"] == "chunk-1" and turn.suggested_followups == ["다음 질문"]


# --- 권리 ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ask_searches_only_rights_open_volumes(ctx: TestClient):
    """권리가 닫힌 권(말씀선집 615권 등)은 AI 질문 검색 범위에서 빠진다 — 원장에 없는 권도 닫힌 것으로 본다."""
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    rows = [
        ("open", "allowed", True, True),
        ("search-only", "allowed", True, False),
        ("615", "allowed", False, False),  # 서고 목록에도 없는 권
        ("full-text-only", "allowed", False, True),
        ("pending", "pending", True, True),
        ("withdrawn", "withdrawn", True, True),
    ]
    for volume, status_, search, full in rows:
        session.add(
            ContentRight(volume=volume, status=status_, scope_search=search, scope_full_text=full, work_title=volume)
        )
    await session.commit()
    await login(ctx)
    assert ask(ctx).status_code == 200
    assert sorted(ctx.chat.volume_filter) == ["open", "search-only"]  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_ask_without_any_open_volume_searches_nothing(ctx: TestClient):
    """권리 원장이 비면 빈 목록(검색 0건)을 넘긴다 — None(필터 없음, 전체 검색)이 아니다."""
    await login(ctx)
    assert ask(ctx).status_code == 200
    assert ctx.chat.volume_filter == []  # type: ignore[attr-defined]


# --- 하루 횟수 ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daily_limit_counts_follow_ups_and_returns_429(ctx: TestClient):
    await login(ctx)
    assert quota(ctx)["remaining"] == settings.hoondok_ask_daily_limit == 5
    session_id = sources_of(ask(ctx))["session_id"]
    for n in range(4):  # 이어 묻기도 1회씩
        assert ask(ctx, f"이어서 {n}", session_id=session_id).status_code == 200
    assert quota(ctx) | {"resets_at": None} == {"limit": 5, "used": 5, "remaining": 0, "resets_at": None}

    over = ask(ctx)
    assert over.status_code == 429
    body = over.json()
    assert body["error_code"] == "ASK_DAILY_LIMIT"
    assert body["details"]["remaining"] == 0 and body["details"]["limit"] == 5
    assert body["details"]["resets_at"].endswith("T00:00:00+09:00")
    assert int(over.headers["Retry-After"]) > 0
    assert quota(ctx)["used"] == 5  # 거절은 차감하지 않는다

    # 다른 계정은 따로 센다
    await login(ctx, "other@example.com")
    assert ask(ctx).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "status"),
    [("가" * 1001, 400), ("   ", 400)],  # 1000자 초과·빈 질문 → 빈 200 스트림이 아니라 400 INPUT_BLOCKED
)
async def test_input_rejected_before_answer_refunds(ctx: TestClient, query, status):
    await login(ctx)
    res = ask(ctx, query)
    assert res.status_code == status and res.json()["error_code"] == "INPUT_BLOCKED"
    assert quota(ctx)["used"] == 0


@pytest.mark.asyncio
async def test_blocked_input_does_not_take_last_slot(ctx: TestClient):
    """남은 1회일 때 거절될 질문이 먼저 와도 차감 전에 걸러져, 뒤이은 정상 질문이 429 를 받지 않는다."""
    user = await login(ctx)
    repo = AskRepository(ctx.session)  # type: ignore[attr-defined]
    service = AskService(repo, ctx.chat, daily_limit=1)  # type: ignore[attr-defined]
    called = []
    original = repo.try_consume

    async def spy(*args, **kwargs):
        called.append(args)
        return await original(*args, **kwargs)

    repo.try_consume = spy  # type: ignore[method-assign]
    from app.modules.hoondok.asks_schemas import AskRequest
    from app.modules.safety.exceptions import InputBlockedError

    with pytest.raises(InputBlockedError):
        await service.start(user.id, AskRequest(query="가" * 1001))
    assert called == []


@pytest.mark.asyncio
async def test_record_failure_refunds_quota(ctx: TestClient, monkeypatch):
    """답은 나갔지만 계정 기록에 실패하면(이어 묻기·다시 열기 불가) 쓴 횟수를 되돌린다."""
    await login(ctx)

    async def broken(self, turn):
        raise RuntimeError("db down")

    monkeypatch.setattr(AskRepository, "record_turn", broken)
    res = ask(ctx)
    assert res.status_code == 200 and sources_of(res)["message_id"]
    assert quota(ctx)["used"] == 0


@pytest.mark.asyncio
async def test_start_charges_kst_day(ctx: TestClient):
    """UTC 15:00 = 다음 KST 날 — 질문 경로(start)가 차감하는 날짜가 KST 다."""
    from app.modules.hoondok.asks_schemas import AskRequest

    user = await login(ctx)
    repo = AskRepository(ctx.session)  # type: ignore[attr-defined]
    at = datetime(2026, 11, 4, 15, 0, tzinfo=timezone.utc)
    service = AskService(repo, ctx.chat, daily_limit=5, now=lambda: at)  # type: ignore[attr-defined]
    frames = await service.start(user.id, AskRequest(query="참사랑이란?"))
    async for _ in frames:
        pass
    days = (await ctx.session.execute(select(AskUsage.day).where(AskUsage.user_id == user.id))).scalars().all()  # type: ignore[attr-defined]
    assert days == [date(2026, 11, 5)]


def test_ask_stream_pipeline_has_no_semantic_cache():
    """비공개 질문은 사용자 구분 없는 시맨틱 캐시에 저장·조회하지 않는다."""
    from app.modules.hoondok.dependencies import get_ask_chat_service

    service = asyncio.run(
        get_ask_chat_service(chat_repo=MagicMock(), chatbot_service=MagicMock(), ingestion_repo=MagicMock())
    )
    assert service.cache_service is None
    assert service.cache_check_stage.cache_service is None
    assert service.persist_stage.cache_service is None


@pytest.mark.asyncio
async def test_pipeline_failure_before_answer_refunds(ctx: TestClient):
    from app.modules.search.exceptions import SearchFailedError

    await login(ctx)
    ctx.chat.fail_after_session = SearchFailedError("검색 실패")  # type: ignore[attr-defined]
    res = ask(ctx)
    assert res.status_code == 503  # 헤더 전에 난 실패라 HTTP 오류로 보인다
    assert quota(ctx)["used"] == 0
    ctx.chat.fail_after_session = None  # type: ignore[attr-defined]
    assert ask(ctx).status_code == 200
    assert quota(ctx)["used"] == 1


@pytest.mark.asyncio
async def test_quota_resets_at_kst_midnight(ctx: TestClient):
    user = await login(ctx)
    repo = AskRepository(ctx.session)  # type: ignore[attr-defined]
    # 2026-11-04 23:59 KST = 14:59 UTC, 다음 날 00:00 KST = 15:00 UTC
    before = datetime(2026, 11, 4, 14, 59, tzinfo=timezone.utc)
    after = datetime(2026, 11, 4, 15, 0, tzinfo=timezone.utc)
    service = AskService(repo, None, daily_limit=1, now=lambda: before)
    assert await repo.try_consume(user.id, date(2026, 11, 4), 1)
    assert (await service.quota(user.id)).remaining == 0
    assert next_reset(before).isoformat() == "2026-11-05T00:00:00+09:00"
    service.now = lambda: after
    fresh = await service.quota(user.id)
    assert fresh.remaining == 1 and fresh.used == 0
    assert fresh.resets_at.isoformat() == "2026-11-06T00:00:00+09:00"


@pytest.mark.asyncio
async def test_concurrent_consume_never_exceeds_limit(tmp_path):
    """같은 계정이 동시에 여러 번 요청해도 limit 을 넘지 않는다(세션별 동시 실행, 파일 SQLite)."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'q.db'}", connect_args={"timeout": 30})
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[User.__table__, AskUsage.__table__])
    user_id = uuid.uuid4()
    day = date(2026, 11, 4)

    async def one() -> bool:
        async with AsyncSession(engine) as session:
            return await AskRepository(session).try_consume(user_id, day, 5)

    results = await asyncio.gather(*(one() for _ in range(12)))
    assert results.count(True) == 5
    async with AsyncSession(engine) as session:
        assert await AskRepository(session).used_on(user_id, day) == 5
    await engine.dispose()


# --- 소유권 ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_follow_up_only_on_own_thread(ctx: TestClient):
    owner = await login(ctx, "owner@example.com")
    session_id = sources_of(ask(ctx))["session_id"]
    # 이어 묻기는 같은 세션으로 이어진다
    again = sources_of(ask(ctx, "그럼요?", session_id=session_id))
    assert again["session_id"] == session_id

    await login(ctx, "other@example.com")
    res = ask(ctx, session_id=session_id)
    assert res.status_code == 403 and res.json()["error_code"] == "SESSION_FORBIDDEN"
    assert ask(ctx, session_id=str(uuid.uuid4())).status_code == 403  # 없는 id 도 같은 403
    assert quota(ctx)["used"] == 0  # 소유 확인은 차감 전

    # 시연 챗 세션(익명) id 로도 훈독에서 이어 묻지 못한다
    demo = ResearchSession(user_id=None)
    ctx.session.add(demo)  # type: ignore[attr-defined]
    await ctx.session.commit()  # type: ignore[attr-defined]
    use(ctx, owner)
    assert ask(ctx, session_id=str(demo.id)).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_or_demo_chat_cannot_continue_hoondok_session(ctx: TestClient):
    """시연 챗(/chat/stream) 경로의 세션 단계는 익명·admin 사용자에게 훈독 세션을 내주지 않는다."""
    await login(ctx)
    session_id = uuid.UUID(sources_of(ask(ctx))["session_id"])
    chat: FakeChatService = ctx.chat  # type: ignore[attr-defined]
    for outsider in (None, uuid.uuid4()):  # 익명, admin_token 사용자
        context = ChatContext(request=ChatRequest(query="이어서", session_id=session_id), user_id=outsider)
        with pytest.raises(SessionOwnershipError):
            await chat.session_stage.execute(context)
        await ctx.session.rollback()  # type: ignore[attr-defined]

    # HTTP 로도: 쿠키 없이, 또는 hoondok_token 값을 admin_token 에 넣어 /chat/stream 에 훈독 세션 id 를 보내도 답이 없다.
    # (/chat/stream 은 스트림 안에서 거절해 오류가 헤더 뒤에 난다 — 기존 동작. 여기서는 이어 쓰지 못함만 본다.)
    raw = TestClient(app, raise_server_exceptions=False)
    me = await ctx.users.get_by_email("reader@example.com")  # type: ignore[attr-defined]
    for cookies in ({}, {"admin_token": IdentityService.issue_token(me)}):
        raw.cookies.clear()
        for name, value in cookies.items():
            raw.cookies.set(name, value)
        res = raw.post("/chat/stream", json={"query": "이어서", "session_id": str(session_id)}, headers=XHR)
        assert "event: sources" not in res.text
    messages = (await ctx.session.execute(select(SessionMessage.content))).scalars().all()  # type: ignore[attr-defined]
    assert "이어서" not in messages


# --- 계정 보관 ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_detail_save_and_delete_mine(ctx: TestClient):
    owner = await login(ctx, "owner@example.com")
    first = sources_of(ask(ctx, "첫 질문", answer_mode="theological"))
    sid = first["session_id"]
    ask(ctx, "이어 묻기", session_id=sid)
    other_sid = sources_of(ask(ctx, "두 번째 대화"))["session_id"]

    items = ctx.get("/hoondok/me/asks").json()["items"]
    assert [i["id"] for i in items] == [other_sid, sid]  # 최근 답 순
    thread = items[1]
    assert thread["question"] == "첫 질문" and thread["turn_count"] == 2
    assert thread["answer_mode"] == "theological" and thread["saved"] is False
    assert thread["public_id"] is None and thread["public_status"] is None

    detail = ctx.get(f"/hoondok/me/asks/{sid}").json()
    assert [t["question"] for t in detail["turns"]] == ["첫 질문", "이어 묻기"]
    assert detail["turns"][0]["answer_md"] == "첫 질문에 대한 답"
    src = detail["turns"][0]["sources"][0]
    assert src["chunk_id"] == "chunk-1" and src["display_name"] == "말씀선집 1권" and src["volume"] == "001권"
    assert detail["turns"][0]["message_id"] == first["message_id"]
    assert detail["turns"][0]["suggested_followups"] == ["다음 질문"]

    # 저장 토글
    assert ctx.patch(f"/hoondok/me/asks/{sid}", json={"saved": True}).status_code == 403  # CSRF
    saved = ctx.patch(f"/hoondok/me/asks/{sid}", json={"saved": True}, headers=XHR)
    assert saved.status_code == 200 and saved.json()["saved"] is True
    assert ctx.get("/hoondok/me/asks").json()["items"][1]["saved"] is True

    # 공개 신청 상태가 목록·상세에 보인다(첫 답)
    pub = ctx.post("/hoondok/me/questions", json={"message_id": first["message_id"]}, headers=XHR)
    assert pub.status_code == 201
    assert ctx.get("/hoondok/me/asks").json()["items"][1]["public_status"] == "pending"
    assert ctx.get(f"/hoondok/me/asks/{sid}").json()["turns"][0]["public_id"] == pub.json()["id"]

    # 남의 것은 목록에 없고, 상세·저장·삭제는 404
    await login(ctx, "other@example.com")
    assert ctx.get("/hoondok/me/asks").json() == {"items": []}
    assert ctx.get(f"/hoondok/me/asks/{sid}").status_code == 404
    assert ctx.patch(f"/hoondok/me/asks/{sid}", json={"saved": False}, headers=XHR).status_code == 404
    assert ctx.delete(f"/hoondok/me/asks/{sid}", headers=XHR).status_code == 404
    assert ctx.get(f"/hoondok/me/asks/{uuid.uuid4()}").status_code == 404

    # 본인 삭제 — 대화·질문·답·인용은 지우고, 공개 신청 복사본은 남긴다(따로 내린다)
    use(ctx, owner)
    assert ctx.delete(f"/hoondok/me/asks/{sid}").status_code == 403  # CSRF
    assert ctx.delete(f"/hoondok/me/asks/{sid}", headers=XHR).status_code == 204
    assert ctx.get(f"/hoondok/me/asks/{sid}").status_code == 404
    assert [i["id"] for i in ctx.get("/hoondok/me/asks").json()["items"]] == [other_sid]
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    assert await session.get(ResearchSession, uuid.UUID(sid)) is None
    left = (await session.execute(select(SessionMessage.session_id))).scalars().all()
    assert set(left) == {uuid.UUID(other_sid)}
    assert len((await session.execute(select(AnswerCitation))).all()) == 1  # 남은 대화의 인용만
    assert (await session.execute(select(PublicQuestion))).scalar_one().id == pub.json()["id"]
    assert ask(ctx, session_id=sid).status_code == 403  # 지운 대화는 이어 묻지 못한다


@pytest.mark.asyncio
async def test_delete_for_user_purges_asks(ctx: TestClient):
    me = await login(ctx, "me@example.com")
    ask(ctx)
    await login(ctx, "keep@example.com")
    kept = sources_of(ask(ctx))["session_id"]
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    # 첫 답 전에 끊긴 세션(thread 없음)도 계정 세션이면 함께 지운다
    orphan = ResearchSession(user_id=me.id)
    session.add(orphan)
    await session.flush()
    session.add(SessionMessage(session_id=orphan.id, role=MessageRole.USER, content="끊긴 질문"))
    await session.commit()

    await AskRepository(session).delete_for_user(me.id)
    await session.commit()
    sessions = (await session.execute(select(ResearchSession.id))).scalars().all()
    assert sessions == [uuid.UUID(kept)]
    assert me.id not in (await session.execute(select(AskUsage.user_id))).scalars().all()
    assert all(t.user_id != me.id for t in (await session.execute(select(AskTurn))).scalars().all())
    assert all(t.user_id != me.id for t in (await session.execute(select(AskThread))).scalars().all())
