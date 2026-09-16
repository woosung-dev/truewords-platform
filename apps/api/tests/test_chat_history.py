"""대화 기록(계정별) — 소유권 검증 · 목록 조회 · 세션 user_id 귀속 단위 테스트."""

import uuid

import pytest
from unittest.mock import AsyncMock

from app.modules.chat.exceptions import SessionOwnershipError
from app.modules.chat.models import MessageRole, ResearchSession, SessionMessage
from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.pipeline.stages.session import SessionStage
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.service import ChatService


def _make_service() -> tuple[ChatService, AsyncMock]:
    chat_repo = AsyncMock()
    chatbot_service = AsyncMock()
    service = ChatService(chat_repo=chat_repo, chatbot_service=chatbot_service)
    return service, chat_repo


@pytest.mark.asyncio
async def test_get_session_history_returns_messages_for_owner():
    service, chat_repo = _make_service()
    owner = uuid.uuid4()
    sid = uuid.uuid4()
    chat_repo.get_session.return_value = ResearchSession(id=sid, user_id=owner)
    chat_repo.get_messages_by_session.return_value = [
        SessionMessage(session_id=sid, role=MessageRole.USER, content="질문"),
        SessionMessage(session_id=sid, role=MessageRole.ASSISTANT, content="답변"),
    ]

    result = await service.get_session_history(sid, owner)

    assert result is not None
    assert result["session_id"] == sid
    assert [m["content"] for m in result["messages"]] == ["질문", "답변"]


@pytest.mark.asyncio
async def test_get_session_history_denies_non_owner():
    service, chat_repo = _make_service()
    sid = uuid.uuid4()
    chat_repo.get_session.return_value = ResearchSession(id=sid, user_id=uuid.uuid4())

    # 다른 사용자 → 존재 여부 노출 없이 None (라우터가 404).
    result = await service.get_session_history(sid, uuid.uuid4())

    assert result is None
    chat_repo.get_messages_by_session.assert_not_called()


@pytest.mark.asyncio
async def test_get_session_history_missing_session_returns_none():
    service, chat_repo = _make_service()
    chat_repo.get_session.return_value = None

    result = await service.get_session_history(uuid.uuid4(), uuid.uuid4())

    assert result is None


@pytest.mark.asyncio
async def test_list_user_sessions_wraps_repo_result():
    service, chat_repo = _make_service()
    user_id = uuid.uuid4()
    items = [
        {
            "session_id": uuid.uuid4(),
            "started_at": "2026-07-10T00:00:00",
            "last_activity": "2026-07-10T00:05:00",
            "message_count": 4,
            "chatbot_name": "말씀봇",
            "preview": "요한복음 3장 16절이 뭔가요?",
        }
    ]
    chat_repo.list_sessions_by_user.return_value = (items, 1)

    result = await service.list_user_sessions(user_id, limit=50, offset=0)

    assert result == {"items": items, "total": 1}
    chat_repo.list_sessions_by_user.assert_awaited_once_with(user_id, 50, 0)


@pytest.mark.asyncio
async def test_session_stage_attributes_user_id_on_new_session():
    chat_repo = AsyncMock()
    chatbot_service = AsyncMock()
    chatbot_service.get_config_id.return_value = None
    # create_session 은 전달된 ResearchSession 을 그대로 반환.
    chat_repo.create_session.side_effect = lambda s: s

    stage = SessionStage(chat_repo, chatbot_service)
    user_id = uuid.uuid4()
    ctx = ChatContext(request=ChatRequest(query="질문"), user_id=user_id)

    created, _reused = await stage._get_or_create_session(ctx)

    assert created.user_id == user_id


@pytest.mark.asyncio
async def test_session_stage_anonymous_when_no_user():
    chat_repo = AsyncMock()
    chatbot_service = AsyncMock()
    chatbot_service.get_config_id.return_value = None
    chat_repo.create_session.side_effect = lambda s: s

    stage = SessionStage(chat_repo, chatbot_service)
    ctx = ChatContext(request=ChatRequest(query="질문"))  # user_id 기본 None

    created, _reused = await stage._get_or_create_session(ctx)

    assert created.user_id is None


# --- SEC-MONO-001: 기존 세션 이어쓰기 소유권 검증 -----------------------------


def _make_stage() -> tuple[SessionStage, AsyncMock]:
    chat_repo = AsyncMock()
    chatbot_service = AsyncMock()
    chatbot_service.get_config_id.return_value = None
    chat_repo.create_session.side_effect = lambda s: s
    return SessionStage(chat_repo, chatbot_service), chat_repo


@pytest.mark.asyncio
async def test_session_stage_rejects_foreign_user_session():
    """다른 사용자의 세션 id → 403 예외, 새 세션도 만들지 않는다."""
    stage, chat_repo = _make_stage()
    sid = uuid.uuid4()
    chat_repo.get_session.return_value = ResearchSession(id=sid, user_id=uuid.uuid4())
    ctx = ChatContext(request=ChatRequest(query="질문", session_id=sid), user_id=uuid.uuid4())

    with pytest.raises(SessionOwnershipError) as exc_info:
        await stage._get_or_create_session(ctx)

    assert exc_info.value.session_id == sid
    chat_repo.create_session.assert_not_called()


@pytest.mark.asyncio
async def test_session_stage_rejects_logged_in_user_on_anonymous_session():
    """로그인 사용자가 익명 세션 id 를 보내도 거부한다."""
    stage, chat_repo = _make_stage()
    sid = uuid.uuid4()
    chat_repo.get_session.return_value = ResearchSession(id=sid, user_id=None)
    ctx = ChatContext(request=ChatRequest(query="질문", session_id=sid), user_id=uuid.uuid4())

    with pytest.raises(SessionOwnershipError):
        await stage._get_or_create_session(ctx)


@pytest.mark.asyncio
async def test_session_stage_rejects_anonymous_on_owned_session():
    """익명 요청이 로그인 사용자의 세션 id 를 보내면 거부한다."""
    stage, chat_repo = _make_stage()
    sid = uuid.uuid4()
    chat_repo.get_session.return_value = ResearchSession(id=sid, user_id=uuid.uuid4())
    ctx = ChatContext(request=ChatRequest(query="질문", session_id=sid))

    with pytest.raises(SessionOwnershipError):
        await stage._get_or_create_session(ctx)


@pytest.mark.asyncio
async def test_session_stage_allows_anonymous_resume_of_anonymous_session():
    """익명 ↔ 익명 재사용은 허용 (비로그인 멀티턴 유지)."""
    stage, chat_repo = _make_stage()
    sid = uuid.uuid4()
    existing = ResearchSession(id=sid, user_id=None)
    chat_repo.get_session.return_value = existing
    ctx = ChatContext(request=ChatRequest(query="질문", session_id=sid))

    session, reused = await stage._get_or_create_session(ctx)

    assert session is existing
    assert reused is True


@pytest.mark.asyncio
async def test_session_stage_allows_owner_resume():
    stage, chat_repo = _make_stage()
    owner = uuid.uuid4()
    sid = uuid.uuid4()
    existing = ResearchSession(id=sid, user_id=owner)
    chat_repo.get_session.return_value = existing
    ctx = ChatContext(request=ChatRequest(query="질문", session_id=sid), user_id=owner)

    session, reused = await stage._get_or_create_session(ctx)

    assert session is existing
    assert reused is True
