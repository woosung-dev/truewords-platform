"""ChatbotService.get_system_prompt R2 Vertical Slice 단위 테스트."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.chatbot.service import ChatbotService


def _make_service_with_config(system_prompt: str | None) -> ChatbotService:
    repo = AsyncMock()
    if system_prompt is None:
        repo.get_by_chatbot_id.return_value = None
    else:
        config = MagicMock()
        config.system_prompt = system_prompt
        repo.get_by_chatbot_id.return_value = config
    return ChatbotService(repo=repo)


@pytest.mark.asyncio
async def test_get_system_prompt_returns_empty_for_none_id():
    service = _make_service_with_config(system_prompt=None)
    assert await service.get_system_prompt(None) == ""


@pytest.mark.asyncio
async def test_get_system_prompt_returns_empty_when_config_missing():
    service = _make_service_with_config(system_prompt=None)
    assert await service.get_system_prompt("nonexistent") == ""


@pytest.mark.asyncio
async def test_get_system_prompt_returns_empty_when_field_blank():
    service = _make_service_with_config(system_prompt="")
    assert await service.get_system_prompt("cfg-1") == ""


@pytest.mark.asyncio
async def test_get_system_prompt_returns_custom_value():
    custom = "너는 TrueWords 전문 상담사다."
    service = _make_service_with_config(system_prompt=custom)
    assert await service.get_system_prompt("cfg-1") == custom
