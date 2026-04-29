"""Cache graceful degradation 테스트 — app.state.cache_available 플래그."""

from unittest.mock import Mock, patch

import pytest
from fastapi import Request

from src.chat.dependencies import get_cache_service


class _StateStub:
    """app.state 흉내용. 동적 속성 부여를 명시적으로 허용 (Pyright 회피)."""

    cache_available: bool | None = None


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
async def test_get_cache_service_lazy_init_on_first_call():
    """state.cache_available=None(미시도)이면 lazy ensure 시도 후 결과 캐싱."""
    mock_request = Mock(spec=Request)
    mock_request.app = Mock()
    # 단순 객체로 state 흉내 (Mock(spec=[])는 attribute set이 막혀서 부적합)
    state = _StateStub()
    state.cache_available = None
    mock_request.app.state = state

    with patch("src.chat.dependencies.ensure_cache_collection") as mock_ensure, \
         patch("src.chat.dependencies.get_async_client"):
        mock_ensure.return_value = None
        result = await get_cache_service(mock_request)
        assert result is not None
        assert state.cache_available is True
        mock_ensure.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_cache_service_lazy_init_failure_caches_false():
    """lazy ensure 실패 시 cache_available=False 캐싱 + None 반환."""
    mock_request = Mock(spec=Request)
    mock_request.app = Mock()
    state = _StateStub()
    state.cache_available = None
    mock_request.app.state = state

    with patch("src.chat.dependencies.ensure_cache_collection") as mock_ensure:
        mock_ensure.side_effect = RuntimeError("connect timeout")
        result = await get_cache_service(mock_request)
        assert result is None
        assert state.cache_available is False


@pytest.mark.asyncio
async def test_get_cache_service_lazy_init_only_once_under_concurrency():
    """동시 요청 다발에서 ensure_cache_collection은 1회만 호출 (asyncio.Lock)."""
    import asyncio as _asyncio
    mock_request = Mock(spec=Request)
    mock_request.app = Mock()
    state = _StateStub()
    state.cache_available = None
    mock_request.app.state = state

    call_count = 0

    async def slow_ensure():
        nonlocal call_count
        call_count += 1
        await _asyncio.sleep(0.05)  # 다른 task가 lock 대기에 진입할 시간

    with patch("src.chat.dependencies.ensure_cache_collection", side_effect=slow_ensure), \
         patch("src.chat.dependencies.get_async_client"):
        # 동시 5건 요청
        results = await _asyncio.gather(
            *[get_cache_service(mock_request) for _ in range(5)]
        )

    assert all(r is not None for r in results)
    assert call_count == 1, f"ensure_cache_collection은 1회만 호출되어야 함 (실제 {call_count})"
    assert state.cache_available is True
