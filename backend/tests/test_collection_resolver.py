"""CollectionResolver 단위 테스트.

Phase 2.4 이후 봇별 컬렉션 토글이 폐기되어, resolver 는 settings 기본값만
반환한다. ChatbotRuntimeConfig 는 호환성을 위해 받지만 미사용이다.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
)
from src.search.collection_resolver import ResolvedCollections, resolve_collections


def _make_runtime_config() -> ChatbotRuntimeConfig:
    return ChatbotRuntimeConfig(
        chatbot_id="test-bot",
        name="Test Bot",
        search=SearchModeConfig(mode="cascading"),
        generation=GenerationConfig(system_prompt="test"),
        retrieval=RetrievalConfig(),
        safety=SafetyConfig(),
    )


class TestResolveCollections:
    def test_uses_settings_default(self) -> None:
        rc = _make_runtime_config()

        with patch("src.search.collection_resolver.settings") as mock_settings:
            mock_settings.collection_name = "default_main"
            mock_settings.cache_collection_name = "default_cache"
            result = resolve_collections(rc)

        assert result == ResolvedCollections(main="default_main", cache="default_cache")

    def test_resolved_collections_is_frozen(self) -> None:
        resolved = ResolvedCollections(main="a", cache="b")
        with pytest.raises(AttributeError):
            resolved.main = "c"  # type: ignore[misc]
