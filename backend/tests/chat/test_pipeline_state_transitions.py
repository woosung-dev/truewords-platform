"""각 Stage 의 pipeline_state 전이 + 사전조건 logger.warning 검증.

핵심 4 케이스 (전체 11 stage 트랜지션 + 1 사전조건 위반).
"""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.cache_check import CacheCheckStage
from src.chat.pipeline.stages.embedding import EmbeddingStage
from src.chat.pipeline.stages.input_validation import InputValidationStage
from src.chat.pipeline.stages.runtime_config import RuntimeConfigStage
from src.chat.pipeline.stages.safety_output import SafetyOutputStage
from src.chat.pipeline.state import PipelineState
from src.chat.schemas import ChatRequest
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
)


def _default_config() -> ChatbotRuntimeConfig:
    return ChatbotRuntimeConfig(
        chatbot_id="d",
        name="d",
        search=SearchModeConfig(mode="cascading"),
        generation=GenerationConfig(system_prompt="sp"),
        retrieval=RetrievalConfig(),
        safety=SafetyConfig(),
    )


class TestPipelineStateTransitions:
    @pytest.mark.asyncio
    async def test_input_validation_transitions_to_INPUT_VALIDATED(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        with patch(
            "src.chat.pipeline.stages.input_validation.validate_input",
            new_callable=AsyncMock,
        ):
            result = await InputValidationStage().execute(ctx)
        assert result.pipeline_state == PipelineState.INPUT_VALIDATED

    @pytest.mark.asyncio
    async def test_embedding_transitions_to_EMBEDDED(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.pipeline_state = PipelineState.SESSION_READY
        with patch(
            "src.chat.pipeline.stages.embedding.embed_dense_query",
            new_callable=AsyncMock,
            return_value=[0.1] * 10,
        ):
            result = await EmbeddingStage().execute(ctx)
        assert result.pipeline_state == PipelineState.EMBEDDED

    @pytest.mark.asyncio
    async def test_cache_check_miss_transitions_to_CACHE_CHECKED(self) -> None:
        cache_service = MagicMock()
        cache_service.check_cache = AsyncMock(return_value=None)
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.pipeline_state = PipelineState.EMBEDDED
        ctx.query_embedding = [0.1] * 10

        result = await CacheCheckStage(cache_service=cache_service).execute(ctx)
        assert result.pipeline_state == PipelineState.CACHE_CHECKED

    @pytest.mark.asyncio
    async def test_cache_check_hit_transitions_to_CACHE_HIT_TERMINATED(self) -> None:
        from src.cache.schemas import CacheHit

        cache_service = MagicMock()
        cache_service.check_cache = AsyncMock(
            return_value=CacheHit(
                question="q",
                answer="a",
                sources=[],
                score=0.95,
                created_at=1.0,
            )
        )
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.pipeline_state = PipelineState.EMBEDDED
        ctx.query_embedding = [0.1] * 10

        with patch(
            "src.chat.pipeline.stages.cache_check.apply_safety_layer",
            new_callable=AsyncMock,
            return_value="safe",
        ):
            result = await CacheCheckStage(cache_service=cache_service).execute(ctx)

        assert result.pipeline_state == PipelineState.CACHE_HIT_TERMINATED

    @pytest.mark.asyncio
    async def test_runtime_config_transitions_to_RUNTIME_RESOLVED(self) -> None:
        chatbot_service = MagicMock()
        chatbot_service.build_runtime_config = AsyncMock(return_value=None)
        default_config = _default_config()
        stage = RuntimeConfigStage(chatbot_service, default_config=default_config)
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.pipeline_state = PipelineState.CACHE_CHECKED
        result = await stage.execute(ctx)
        assert result.pipeline_state == PipelineState.RUNTIME_RESOLVED

    @pytest.mark.asyncio
    async def test_safety_output_transitions_to_SAFETY_APPLIED(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.pipeline_state = PipelineState.GENERATED
        ctx.answer = "answer"
        with patch(
            "src.chat.pipeline.stages.safety_output.apply_safety_layer",
            new_callable=AsyncMock,
            return_value="safe answer",
        ):
            result = await SafetyOutputStage().execute(ctx)
        assert result.pipeline_state == PipelineState.SAFETY_APPLIED


class TestPreconditionWarning:
    @pytest.mark.asyncio
    async def test_embedding_warns_when_state_is_init(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        # 사전조건은 SESSION_READY 인데 INIT 상태에서 호출
        with caplog.at_level(logging.WARNING, logger="src.chat.pipeline.state"):
            with patch(
                "src.chat.pipeline.stages.embedding.embed_dense_query",
                new_callable=AsyncMock,
                return_value=[0.1] * 10,
            ):
                await EmbeddingStage().execute(ctx)

        assert any(
            "EmbeddingStage precondition failed" in rec.getMessage()
            for rec in caplog.records
        )

    @pytest.mark.asyncio
    async def test_cache_hit_terminated_silent_skip_no_warning(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # CACHE_HIT_TERMINATED 상태에서 SafetyOutputStage 호출 → 경고 없어야 함
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.pipeline_state = PipelineState.CACHE_HIT_TERMINATED
        ctx.answer = "a"
        with caplog.at_level(logging.WARNING, logger="src.chat.pipeline.state"):
            with patch(
                "src.chat.pipeline.stages.safety_output.apply_safety_layer",
                new_callable=AsyncMock,
                return_value="safe",
            ):
                await SafetyOutputStage().execute(ctx)

        assert not any(
            "precondition failed" in rec.getMessage() for rec in caplog.records
        )
