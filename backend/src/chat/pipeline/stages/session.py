"""SessionStage — 세션 생성/재사용 + 사용자 메시지 저장."""

from __future__ import annotations

from src.chat.models import MessageRole, ResearchSession, SessionMessage
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.chat.repository import ChatRepository
from src.chatbot.service import ChatbotService


class SessionStage:
    def __init__(self, chat_repo: ChatRepository, chatbot_service: ChatbotService) -> None:
        self.chat_repo = chat_repo
        self.chatbot_service = chatbot_service

    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        ctx.session = await self._get_or_create_session(ctx)
        ctx.user_message = await self.chat_repo.create_message(
            SessionMessage(
                session_id=ctx.session.id,
                role=MessageRole.USER,
                content=ctx.request.query,
            )
        )
        ctx.pipeline_state = PipelineState.SESSION_READY
        return ctx

    async def _get_or_create_session(self, ctx: ChatContext) -> ResearchSession:
        if ctx.request.session_id:
            existing = await self.chat_repo.get_session(ctx.request.session_id)
            if existing:
                return existing
        config_id = await self.chatbot_service.get_config_id(ctx.request.chatbot_id)
        return await self.chat_repo.create_session(
            ResearchSession(chatbot_config_id=config_id, client_fingerprint=None)
        )
