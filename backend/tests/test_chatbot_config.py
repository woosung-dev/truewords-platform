"""ChatbotService 단위 테스트 (DB 없이 mock)."""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException

from src.chatbot.service import ChatbotService, DEFAULT_CASCADING_CONFIG
from src.chatbot.models import ChatbotConfig
from src.chatbot.schemas import (
    ChatbotConfigCreate,
    ChatbotConfigUpdate,
    SearchTierSchema,
    SearchTiersConfig,
)
from src.search.cascading import CascadingConfig


@pytest.fixture
def mock_repo():
    return AsyncMock()


@pytest.fixture
def service(mock_repo):
    return ChatbotService(repo=mock_repo)


# --- get_cascading_config ---


@pytest.mark.asyncio
async def test_get_cascading_config_returns_default_when_none(service):
    config = await service.get_cascading_config(None)
    assert config is DEFAULT_CASCADING_CONFIG


@pytest.mark.asyncio
async def test_get_cascading_config_raises_404_when_not_found(service, mock_repo):
    mock_repo.get_by_chatbot_id.return_value = None
    with pytest.raises(HTTPException) as exc_info:
        await service.get_cascading_config("nonexistent")
    assert exc_info.value.status_code == 404


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


# --- get_by_id ---


@pytest.mark.asyncio
async def test_get_by_id_returns_config(service, mock_repo):
    config_id = uuid.uuid4()
    mock_config = MagicMock(spec=ChatbotConfig)
    mock_repo.get_by_id.return_value = mock_config

    result = await service.get_by_id(config_id)
    assert result is mock_config
    mock_repo.get_by_id.assert_called_once_with(config_id)


@pytest.mark.asyncio
async def test_get_by_id_raises_404_when_not_found(service, mock_repo):
    mock_repo.get_by_id.return_value = None
    with pytest.raises(HTTPException) as exc_info:
        await service.get_by_id(uuid.uuid4())
    assert exc_info.value.status_code == 404


# --- list_paginated ---


@pytest.mark.asyncio
async def test_list_paginated(service, mock_repo):
    mock_repo.list_paginated.return_value = []
    mock_repo.count_all.return_value = 0

    items, total = await service.list_paginated(limit=20, offset=0)

    assert items == []
    assert total == 0
    mock_repo.list_paginated.assert_called_once_with(limit=20, offset=0)
    mock_repo.count_all.assert_called_once()


# --- list_active ---


@pytest.mark.asyncio
async def test_list_active_calls_repo(service, mock_repo):
    mock_repo.list_active.return_value = []
    result = await service.list_active()
    mock_repo.list_active.assert_called_once()
    assert result == []


# --- SearchTierSchema 검증 ---


def test_search_tier_schema_valid():
    tier = SearchTierSchema(sources=["A", "B"], min_results=3, score_threshold=0.75)
    assert tier.sources == ["A", "B"]
    assert tier.min_results == 3
    assert tier.score_threshold == 0.75


def test_search_tier_schema_defaults():
    tier = SearchTierSchema(sources=["A"])
    assert tier.min_results == 3
    assert tier.score_threshold == 0.1


def test_search_tier_schema_invalid_min_results():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SearchTierSchema(sources=["A"], min_results=0)


def test_search_tier_schema_invalid_min_results_too_high():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SearchTierSchema(sources=["A"], min_results=21)


def test_search_tier_schema_invalid_score_threshold_low():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SearchTierSchema(sources=["A"], score_threshold=-0.1)


def test_search_tier_schema_invalid_score_threshold_high():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SearchTierSchema(sources=["A"], score_threshold=1.1)


def test_search_tier_schema_empty_sources():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SearchTierSchema(sources=[])


def test_search_tiers_config_empty_tiers():
    config = SearchTiersConfig(tiers=[])
    assert config.tiers == []


def test_search_tiers_config_valid():
    config = SearchTiersConfig(
        tiers=[
            SearchTierSchema(sources=["A"], min_results=3, score_threshold=0.75),
            SearchTierSchema(sources=["B", "C"], min_results=2, score_threshold=0.60),
        ]
    )
    assert len(config.tiers) == 2
