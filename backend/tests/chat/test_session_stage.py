"""SessionStage 단위 테스트."""

from __future__ import annotations

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.chat.models import MessageRole, ResearchSession, SessionMessage
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.session import SessionStage
from src.chat.schemas import ChatRequest


def _make_session(session_id=None, config_id=None):
    s = MagicMock(spec=ResearchSession)
    s.id = session_id or uuid.uuid4()
    s.chatbot_config_id = config_id
    return s


def _make_message(msg_id=None):
    m = MagicMock(spec=SessionMessage)
    m.id = msg_id or uuid.uuid4()
    m.role = MessageRole.USER
    return m


class TestSessionStage:
    @pytest.mark.asyncio
    async def test_creates_new_session_when_no_session_id(self) -> None:
        chat_repo = AsyncMock()
        chatbot_service = AsyncMock()
        new_session = _make_session()
        user_msg = _make_message()

        chat_repo.get_session.return_value = None
        chat_repo.create_session.return_value = new_session
        chat_repo.create_message.return_value = user_msg
        chatbot_service.get_config_id.return_value = uuid.uuid4()

        stage = SessionStage(chat_repo, chatbot_service)
        ctx = ChatContext(request=ChatRequest(query="질문"))
        result = await stage.execute(ctx)

        assert result.session is new_session
        assert result.user_message is user_msg
        chat_repo.create_session.assert_awaited_once()
        chat_repo.create_message.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_reuses_existing_session(self) -> None:
        chat_repo = AsyncMock()
        chatbot_service = AsyncMock()
        existing_session = _make_session()
        user_msg = _make_message()

        chat_repo.get_session.return_value = existing_session
        chat_repo.create_message.return_value = user_msg

        stage = SessionStage(chat_repo, chatbot_service)
        sid = uuid.uuid4()
        ctx = ChatContext(request=ChatRequest(query="질문", session_id=sid))
        result = await stage.execute(ctx)

        assert result.session is existing_session
        chat_repo.get_session.assert_awaited_once_with(sid)
        chat_repo.create_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_creates_new_when_session_id_not_found(self) -> None:
        chat_repo = AsyncMock()
        chatbot_service = AsyncMock()
        new_session = _make_session()
        user_msg = _make_message()

        chat_repo.get_session.return_value = None
        chat_repo.create_session.return_value = new_session
        chat_repo.create_message.return_value = user_msg
        chatbot_service.get_config_id.return_value = uuid.uuid4()

        stage = SessionStage(chat_repo, chatbot_service)
        sid = uuid.uuid4()
        ctx = ChatContext(request=ChatRequest(query="질문", session_id=sid))
        result = await stage.execute(ctx)

        assert result.session is new_session
        chat_repo.create_session.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_new_session_carries_participant_fields(self) -> None:
        """레드팀 시연 — 게이트 입력 참여자 정보가 신규 세션에 귀속."""
        chat_repo = AsyncMock()
        chatbot_service = AsyncMock()
        chat_repo.get_session.return_value = None
        chat_repo.create_session.return_value = _make_session()
        chat_repo.create_message.return_value = _make_message()
        chatbot_service.get_config_id.return_value = None

        stage = SessionStage(chat_repo, chatbot_service)
        ctx = ChatContext(
            request=ChatRequest(
                query="질문",
                participant_name="홍길동",
                participant_category="청년부",
            )
        )
        await stage.execute(ctx)

        created = chat_repo.create_session.call_args[0][0]
        assert created.participant_name == "홍길동"
        assert created.participant_category == "청년부"

    @pytest.mark.asyncio
    async def test_persists_user_message_with_role_user(self) -> None:
        chat_repo = AsyncMock()
        chatbot_service = AsyncMock()
        session = _make_session()
        user_msg = _make_message()

        chat_repo.create_session.return_value = session
        chat_repo.create_message.return_value = user_msg
        chatbot_service.get_config_id.return_value = None

        stage = SessionStage(chat_repo, chatbot_service)
        ctx = ChatContext(request=ChatRequest(query="테스트 질문"))
        await stage.execute(ctx)

        call_args = chat_repo.create_message.call_args[0][0]
        assert call_args.role == MessageRole.USER
        assert call_args.content == "테스트 질문"
        assert call_args.session_id == session.id
