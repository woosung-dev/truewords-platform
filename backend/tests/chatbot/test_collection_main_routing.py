"""ChatbotConfig.collection_main 컬럼이 build_runtime_config에서 SearchModeConfig.collection_main으로 흘러가는지 검증."""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from src.chatbot.models import ChatbotConfig
from src.chatbot.service import ChatbotService


@pytest.mark.asyncio
async def test_runtime_config_uses_record_collection_main(monkeypatch) -> None:
    record = ChatbotConfig(
        id=uuid.uuid4(),
        chatbot_id="t",
        display_name="t",
        search_tiers={"search_mode": "weighted", "weighted_sources": []},
        collection_main="malssum_poc_v2",
    )
    repo = AsyncMock()
    repo.get_by_chatbot_id = AsyncMock(return_value=record)
    service = ChatbotService(repo)
    cfg = await service.build_runtime_config("t")
    assert cfg is not None
    assert cfg.search.collection_main == "malssum_poc_v2"


@pytest.mark.asyncio
async def test_runtime_config_falls_back_to_json_collection_main_when_record_default() -> None:
    """별도 컬럼이 'malssum_poc' 기본값일 때, search_tiers JSON 안 collection_main이 우선."""
    record = ChatbotConfig(
        id=uuid.uuid4(),
        chatbot_id="t",
        display_name="t",
        search_tiers={
            "search_mode": "weighted",
            "weighted_sources": [],
            "collection_main": "malssum_poc_v2",
        },
        collection_main="malssum_poc",
    )
    repo = AsyncMock()
    repo.get_by_chatbot_id = AsyncMock(return_value=record)
    service = ChatbotService(repo)
    cfg = await service.build_runtime_config("t")
    assert cfg is not None
    # JSON에 명시적으로 v2가 있으면 그걸 따라야 (admin UI 1차 사용성)
    assert cfg.search.collection_main == "malssum_poc_v2"
