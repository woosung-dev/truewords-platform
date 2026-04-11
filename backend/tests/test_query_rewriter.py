"""Query Rewriter 비동기 테스트."""

import pytest
from unittest.mock import AsyncMock, patch
from src.search.query_rewriter import rewrite_query


@pytest.mark.asyncio
async def test_rewrite_query_returns_rewritten_text():
    """LLM이 재작성된 쿼리를 반환하면 그 결과를 사용해야 함."""
    rewritten = "참부모님이 말씀하신 축복의 의미와 정의"

    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock, return_value=rewritten):
        result = await rewrite_query("축복이 뭐야?")

    assert result == rewritten


@pytest.mark.asyncio
async def test_rewrite_query_graceful_degradation_on_exception():
    """LLM 호출 실패 시 원본 쿼리를 반환해야 함."""
    original = "참사랑이 무엇인가요?"

    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock, side_effect=Exception("API Error")):
        result = await rewrite_query(original)

    assert result == original


@pytest.mark.asyncio
async def test_rewrite_query_returns_original_on_empty_response():
    """LLM이 빈 문자열을 반환하면 원본 쿼리를 반환해야 함."""
    original = "천일국이 뭐예요?"

    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock, return_value=""):
        result = await rewrite_query(original)

    assert result == original


@pytest.mark.asyncio
async def test_rewrite_query_timeout_returns_original():
    """asyncio.TimeoutError 발생 시 원본 쿼리를 반환해야 함."""
    import asyncio

    original = "원리강론이 무엇인가요?"

    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock, side_effect=asyncio.TimeoutError):
        result = await rewrite_query(original)

    assert result == original


@pytest.mark.asyncio
async def test_rewrite_query_strips_whitespace():
    """LLM 응답 앞뒤 공백을 제거해야 함."""
    original = "훈독회가 무엇인가요?"
    rewritten_with_whitespace = "  훈독회의 의미와 목적에 대해  "

    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock, return_value=rewritten_with_whitespace):
        result = await rewrite_query(original)

    assert result == "훈독회의 의미와 목적에 대해"
