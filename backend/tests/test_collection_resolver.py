"""CollectionResolver 단위 테스트."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from src.search.collection_resolver import ResolvedCollections, resolve_collections
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
)


def _make_runtime_config(
    collection_main: str | None = None,
    collection_cache: str | None = None,
) -> ChatbotRuntimeConfig:
    return ChatbotRuntimeConfig(
        chatbot_id="test-bot",
        name="Test Bot",
        search=SearchModeConfig(
            mode="cascading",
            collection_main=collection_main,
            collection_cache=collection_cache,
        ),
        generation=GenerationConfig(system_prompt="test"),
        retrieval=RetrievalConfig(),
        safety=SafetyConfig(),
    )


class TestResolveCollections:
    def test_uses_settings_default_when_runtime_none(self) -> None:
        rc = _make_runtime_config(collection_main=None, collection_cache=None)

        with patch("src.search.collection_resolver.settings") as mock_settings:
            mock_settings.collection_name = "default_main"
            mock_settings.cache_collection_name = "default_cache"
            result = resolve_collections(rc)

        assert result == ResolvedCollections(main="default_main", cache="default_cache")

    def test_uses_runtime_value_when_set(self) -> None:
        rc = _make_runtime_config(
            collection_main="custom_main",
            collection_cache="custom_cache",
        )

        with patch("src.search.collection_resolver.settings") as mock_settings:
            mock_settings.collection_name = "should_not_use"
            mock_settings.cache_collection_name = "should_not_use"
            result = resolve_collections(rc)

        assert result == ResolvedCollections(main="custom_main", cache="custom_cache")

    def test_partial_override_main_only(self) -> None:
        rc = _make_runtime_config(collection_main="custom_main", collection_cache=None)

        with patch("src.search.collection_resolver.settings") as mock_settings:
            mock_settings.collection_name = "fallback_main"
            mock_settings.cache_collection_name = "fallback_cache"
            result = resolve_collections(rc)

        assert result.main == "custom_main"
        assert result.cache == "fallback_cache"

    def test_partial_override_cache_only(self) -> None:
        rc = _make_runtime_config(collection_main=None, collection_cache="custom_cache")

        with patch("src.search.collection_resolver.settings") as mock_settings:
            mock_settings.collection_name = "fallback_main"
            mock_settings.cache_collection_name = "fallback_cache"
            result = resolve_collections(rc)

        assert result.main == "fallback_main"
        assert result.cache == "custom_cache"

    def test_resolved_collections_is_frozen(self) -> None:
        resolved = ResolvedCollections(main="a", cache="b")
        with pytest.raises(AttributeError):
            resolved.main = "c"  # type: ignore[misc]
