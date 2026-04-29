"""Cache graceful degradation 테스트.

[HOTFIX] Cache는 영구 비활성 상태 — get_cache_service 는 항상 None 반환.
SemanticCacheService 전체를 raw httpx 로 전환하는 후속 PR 머지 후 본 테스트도
정식 동작 검증으로 복구 예정. (docs/dev-log/46-qdrant-cache-cold-start-debug.md)
"""

import pytest

from src.chat.dependencies import get_cache_service


@pytest.mark.asyncio
async def test_get_cache_service_returns_none():
    """Hotfix: 모든 호출에 None 반환 — chat 은 cache 없이 graceful 진행."""
    result = await get_cache_service()
    assert result is None
