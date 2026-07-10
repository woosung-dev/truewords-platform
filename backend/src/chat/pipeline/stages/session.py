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
            ResearchSession(
                # 로그인 사용자면 귀속 → 대화 기록 목록 조회 대상. 익명이면 None.
                user_id=ctx.user_id,
                chatbot_config_id=config_id,
                client_fingerprint=None,
                # 레드팀 시연 — 게이트 입력값을 세션에 귀속 (신규 세션 1회만).
                participant_name=ctx.request.participant_name,
                participant_category=ctx.request.participant_category,
            )
        )
