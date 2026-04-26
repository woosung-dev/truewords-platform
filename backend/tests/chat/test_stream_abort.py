"""스트림 비정상 종료 (CancelledError / GeneratorExit) 시 force_transition_to 적용 검증."""

from __future__ import annotations

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.chat.models import ResearchSession
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, force_transition_to
from src.chat.schemas import ChatRequest


class TestForceTransitionTo:
    def test_force_transition_updates_state_and_logs_warning(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.pipeline_state = PipelineState.RERANKED

        with caplog.at_level(logging.WARNING, logger="src.chat.pipeline.state"):
            force_transition_to(
                ctx, PipelineState.STREAM_ABORTED, reason="client_disconnect"
            )

        assert ctx.pipeline_state == PipelineState.STREAM_ABORTED
        assert any(
            "fsm_forced_transition" in rec.getMessage()
            and "client_disconnect" in rec.getMessage()
            for rec in caplog.records
        )


class TestStreamAbortIntegration:
    @pytest.mark.asyncio
    async def test_stream_abort_force_transitions_to_STREAM_ABORTED(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """SSE 스트리밍 중간에 CancelledError 발생 → ctx.pipeline_state = STREAM_ABORTED."""
        from src.chat.service import ChatService

        # Repo + chatbot mocks
        chat_repo = MagicMock()
        session_obj = ResearchSession()
        chat_repo.create_session = AsyncMock(return_value=session_obj)
        chat_repo.get_session = AsyncMock(return_value=None)
        captured_msg = MagicMock()
        captured_msg.id = session_obj.id
        chat_repo.create_message = AsyncMock(return_value=captured_msg)
        chat_repo.commit = AsyncMock()
        chat_repo.create_search_event = AsyncMock()
        chat_repo.create_citations = AsyncMock()

        chatbot_service = MagicMock()
        chatbot_service.build_runtime_config = AsyncMock(return_value=None)
        chatbot_service.get_config_id = AsyncMock(return_value=None)

        service = ChatService(chat_repo, chatbot_service, cache_service=None)

        async def cancelled_gen(*args, **kwargs):
            raise asyncio.CancelledError()
            yield  # pragma: no cover

        with (
            patch(
                "src.chat.pipeline.stages.input_validation.validate_input",
                new_callable=AsyncMock,
            ),
            patch(
                "src.chat.pipeline.stages.embedding.embed_dense_query",
                new_callable=AsyncMock,
                return_value=[0.1] * 1536,
            ),
            patch(
                "src.chat.service.generate_answer_stream",
                side_effect=cancelled_gen,
            ),
            patch(
                "src.chat.pipeline.stages.search.cascading_search",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "src.chat.pipeline.stages.search.fallback_search",
                new_callable=AsyncMock,
                return_value=([], "none"),
            ),
            patch(
                "src.qdrant_client.get_async_client",
                return_value=MagicMock(),
            ),
            caplog.at_level(logging.WARNING, logger="src.chat.pipeline.state"),
        ):
            with pytest.raises(asyncio.CancelledError):
                async for _ in service.process_chat_stream(
                    ChatRequest(query="질문")
                ):
                    pass

        assert any(
            "fsm_forced_transition" in rec.getMessage()
            and "STREAM_ABORTED" in rec.getMessage()
            for rec in caplog.records
        )
