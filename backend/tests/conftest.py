"""테스트 공통 픽스처."""

import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_qdrant():
    """비동기 Qdrant 클라이언트 목."""
    client = AsyncMock()
    client.query_points = AsyncMock()
    return client
