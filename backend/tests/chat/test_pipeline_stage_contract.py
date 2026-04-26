"""Stage Protocol + ChatContext 계약 테스트."""

from __future__ import annotations

import pytest

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stage import Stage
from src.chat.pipeline.state import PipelineState
from src.chat.schemas import ChatRequest


class _DummyStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        ctx.session = "dummy"
        return ctx


class TestStageProtocol:
    def test_dummy_satisfies_protocol(self) -> None:
        stage: Stage = _DummyStage()
        assert hasattr(stage, "execute")

    @pytest.mark.asyncio
    async def test_dummy_stage_modifies_context(self) -> None:
        stage = _DummyStage()
        ctx = ChatContext(request=ChatRequest(query="test"))
        result = await stage.execute(ctx)
        assert result.session == "dummy"


class TestChatContext:
    def test_default_values(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="hello"))
        assert ctx.request.query == "hello"
        assert ctx.session is None
        assert ctx.user_message is None
        assert ctx.cache_hit is False
        assert ctx.cache_response is None
        assert ctx.pipeline_state == PipelineState.INIT

    def test_mutable(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.session = "s"
        ctx.user_message = "m"
        assert ctx.session == "s"
        assert ctx.user_message == "m"
