"""Cache graceful degradation 테스트 — app.state.cache_available 플래그."""

from unittest.mock import Mock, patch

import pytest
from fastapi import Request

from src.chat.dependencies import get_cache_service


@pytest.mark.asyncio
async def test_get_cache_service_returns_none_when_cache_unavailable():
    """app.state.cache_available=False면 None 반환."""
    mock_request = Mock(spec=Request)
    mock_request.app = Mock()
    mock_request.app.state = Mock()
    mock_request.app.state.cache_available = False

    result = await get_cache_service(mock_request)
    assert result is None


@pytest.mark.asyncio
async def test_get_cache_service_returns_service_when_cache_available():
    """app.state.cache_available=True면 SemanticCacheService 인스턴스 반환."""
    mock_request = Mock(spec=Request)
    mock_request.app = Mock()
    mock_request.app.state = Mock()
    mock_request.app.state.cache_available = True

    with patch("src.chat.dependencies.get_async_client"):
        result = await get_cache_service(mock_request)
        assert result is not None


@pytest.mark.asyncio
async def test_get_cache_service_defaults_to_available_when_attr_missing():
    """state에 cache_available 속성이 없으면 default True로 동작."""
    mock_request = Mock(spec=Request)
    mock_request.app = Mock()
    mock_request.app.state = Mock(spec=[])  # cache_available 속성 없음

    with patch("src.chat.dependencies.get_async_client"):
        result = await get_cache_service(mock_request)
        # getattr(..., default=True) 덕분에 fallback 동작
        assert result is not None
