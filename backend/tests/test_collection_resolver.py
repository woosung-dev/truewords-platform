"""CollectionResolver 단위 테스트.

Phase 2.4 (v5 단일 운영) 이후 resolver 는 인자 없이 settings 기본값만 반환한다.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from src.search.collection_resolver import ResolvedCollections, resolve_collections


class TestResolveCollections:
    def test_uses_settings_default(self) -> None:
        with patch("src.search.collection_resolver.settings") as mock_settings:
            mock_settings.collection_name = "default_main"
            mock_settings.cache_collection_name = "default_cache"
            result = resolve_collections()

        assert result == ResolvedCollections(main="default_main", cache="default_cache")

    def test_resolved_collections_is_frozen(self) -> None:
        resolved = ResolvedCollections(main="a", cache="b")
        with pytest.raises(AttributeError):
            resolved.main = "c"  # type: ignore[misc]
