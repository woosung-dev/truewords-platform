"""대화 기록(계정별) — 소유권 검증 · 목록 조회 · 세션 user_id 귀속 단위 테스트."""

import uuid

import pytest
from unittest.mock import AsyncMock

from src.chat.models import MessageRole, ResearchSession, SessionMessage
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.session import SessionStage
from src.chat.schemas import ChatRequest
from src.chat.service import ChatService


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
