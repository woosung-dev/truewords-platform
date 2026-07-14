"""SessionStage — 세션 생성/재사용 + 멀티턴 이력 로드 + 사용자 메시지 저장."""

from __future__ import annotations

from src.chat.history import estimate_tokens
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
        session, reused = await self._get_or_create_session(ctx)
        ctx.session = session
        # 멀티턴 — 이력은 현재 user 메시지 create_message **전**에 읽어야
        # 자기 자신이 섞이지 않는다. 신규 세션은 이력이 없으므로 조회 생략.
        # 봇별 multiturn_enabled=False 면 이력을 아예 로드하지 않아 → ctx.history 가
        # 비고, 후속 단계(condense·이력 주입·캐시 게이트)가 전부 단일턴으로 복귀한다.
        if reused and await self._is_multiturn_enabled(ctx.request.chatbot_id):
            ctx.history = await self.chat_repo.get_recent_messages(session.id)
        ctx.user_message = await self.chat_repo.create_message(
            SessionMessage(
                session_id=session.id,
                role=MessageRole.USER,
                content=ctx.request.query,
                token_count=estimate_tokens(ctx.request.query),
            )
        )
        ctx.pipeline_state = PipelineState.SESSION_READY
        return ctx

    async def _is_multiturn_enabled(self, chatbot_id: str | None) -> bool:
        """봇별 멀티턴(대화 이력) 토글 조회. 기본 ON.

        RuntimeConfigStage 는 이 stage 뒤에 실행돼 ctx.runtime_config 가 아직
        없으므로, 봇 설정을 직접 조회한다 (기존 build_runtime_config 재사용).
        chatbot_id=None(시스템 기본 봇)은 멀티턴 기본 ON — DEFAULT_RUNTIME_CONFIG
        와 동일. (순환 import 회피 위해 상수 대신 True 리터럴.)
        """
        config = await self.chatbot_service.build_runtime_config(chatbot_id)
        return config.retrieval.multiturn_enabled if config else True

    async def _get_or_create_session(self, ctx: ChatContext) -> tuple[ResearchSession, bool]:
        """(세션, 기존 세션 재사용 여부) 반환."""
        if ctx.request.session_id:
            existing = await self.chat_repo.get_session(ctx.request.session_id)
            if existing:
                return existing, True
        config_id = await self.chatbot_service.get_config_id(ctx.request.chatbot_id)
        created = await self.chat_repo.create_session(
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
        return created, False
