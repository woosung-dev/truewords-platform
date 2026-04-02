"""ChatbotService 단위 테스트 (DB 없이 mock)."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.chatbot.service import ChatbotService
from src.chatbot.models import ChatbotConfig
from src.search.cascading import CascadingConfig


@pytest.fixture
def mock_repo():
    return AsyncMock()


@pytest.fixture
def service(mock_repo):
    return ChatbotService(repo=mock_repo)


@pytest.mark.asyncio
async def test_get_cascading_config_returns_default_when_none(service):
    config = await service.get_cascading_config(None)
    assert isinstance(config, CascadingConfig)
    assert len(config.tiers) >= 1


@pytest.mark.asyncio
async def test_get_cascading_config_returns_default_when_not_found(service, mock_repo):
    mock_repo.get_by_chatbot_id.return_value = None
    config = await service.get_cascading_config("nonexistent")
    assert isinstance(config, CascadingConfig)


@pytest.mark.asyncio
async def test_get_cascading_config_parses_db_tiers(service, mock_repo):
    db_config = MagicMock(spec=ChatbotConfig)
    db_config.search_tiers = {
        "tiers": [
            {"sources": ["A"], "min_results": 3, "score_threshold": 0.75},
            {"sources": ["B"], "min_results": 2, "score_threshold": 0.65},
        ]
    }
    mock_repo.get_by_chatbot_id.return_value = db_config

    config = await service.get_cascading_config("malssum_priority")

    assert isinstance(config, CascadingConfig)
    assert len(config.tiers) == 2
    assert config.tiers[0].sources == ["A"]
    assert config.tiers[1].score_threshold == 0.65


@pytest.mark.asyncio
async def test_list_active_calls_repo(service, mock_repo):
    mock_repo.list_active.return_value = []
    result = await service.list_active()
    mock_repo.list_active.assert_called_once()
    assert result == []
