"""테스트 공통 픽스처."""

import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture(autouse=True)
def _empty_featured_malssum(monkeypatch):
    """테스트는 말씀 풀을 빈 목록으로 고정 — featured_malssum.json 이 로컬에서
    채워져 있어도 pick_malssum_for_answer 가 실제 LLM 을 호출하지 않게 한다.
    말씀 자체를 검증하는 테스트는 각자 monkeypatch 로 _items 를 덮어쓴다(우선)."""
    import src.malssum.service as _malssum

    monkeypatch.setattr(_malssum, "_items", [])


@pytest.fixture
def mock_qdrant():
    """비동기 Qdrant 클라이언트 목."""
    client = AsyncMock()
    client.query_points = AsyncMock()
    return client
