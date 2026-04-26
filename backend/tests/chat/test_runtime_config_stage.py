"""RuntimeConfigStage 단위 테스트."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.runtime_config import RuntimeConfigStage
from src.chat.schemas import ChatRequest
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
)


def _make_config(name: str = "test") -> ChatbotRuntimeConfig:
    return ChatbotRuntimeConfig(
        chatbot_id="cid",
        name=name,
        search=SearchModeConfig(mode="cascading"),
        generation=GenerationConfig(system_prompt="sp"),
        retrieval=RetrievalConfig(),
        safety=SafetyConfig(),
    )


class TestRuntimeConfigStage:
    @pytest.mark.asyncio
    async def test_uses_chatbot_service_value(self) -> None:
        chatbot_service = MagicMock()
        resolved = _make_config(name="resolved")
        chatbot_service.build_runtime_config = AsyncMock(return_value=resolved)
        default_config = _make_config(name="default")

        stage = RuntimeConfigStage(chatbot_service, default_config=default_config)
        ctx = ChatContext(request=ChatRequest(query="q", chatbot_id="cid"))
        result = await stage.execute(ctx)

        assert result.runtime_config is resolved
        chatbot_service.build_runtime_config.assert_awaited_once_with("cid")

    @pytest.mark.asyncio
    async def test_falls_back_to_default_when_none(self) -> None:
        chatbot_service = MagicMock()
        chatbot_service.build_runtime_config = AsyncMock(return_value=None)
        default_config = _make_config(name="default")

        stage = RuntimeConfigStage(chatbot_service, default_config=default_config)
        ctx = ChatContext(request=ChatRequest(query="q"))
        result = await stage.execute(ctx)

        assert result.runtime_config is default_config
