"""hybrid_search 비동기 테스트."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from src.search.hybrid import hybrid_search, SearchResult


def _make_mock_point(text: str, volume: str, score: float, source: str = ""):
    point = MagicMock()
    point.payload = {"text": text, "volume": volume, "chunk_index": 0, "source": source}
    point.score = score
    return point


@pytest.mark.asyncio
async def test_hybrid_search_returns_search_results():
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.points = [
        _make_mock_point("하나님의 사랑", "vol_001", 0.95),
        _make_mock_point("참부모님 말씀", "vol_002", 0.88),
    ]
    mock_client.query_points.return_value = mock_response

    with (
        patch("src.search.hybrid.embed_dense_query", new_callable=AsyncMock, return_value=[0.1] * 768),
        patch("src.search.hybrid.embed_sparse_async", new_callable=AsyncMock, return_value=([1, 2], [0.5, 0.3])),
    ):
        results = await hybrid_search(mock_client, "하나님 사랑이란", top_k=10)

    assert len(results) == 2
    assert all(isinstance(r, SearchResult) for r in results)
    assert results[0].text == "하나님의 사랑"
    assert results[0].score == 0.95


@pytest.mark.asyncio
async def test_hybrid_search_with_source_filter():
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.points = [_make_mock_point("A 말씀", "vol_001", 0.90, "A")]
    mock_client.query_points.return_value = mock_response

    with (
        patch("src.search.hybrid.embed_dense_query", new_callable=AsyncMock, return_value=[0.1] * 768),
        patch("src.search.hybrid.embed_sparse_async", new_callable=AsyncMock, return_value=([1, 2], [0.5, 0.3])),
    ):
        results = await hybrid_search(mock_client, "질문", top_k=10, source_filter=["A"])

    call_kwargs = mock_client.query_points.call_args.kwargs
    assert call_kwargs["query_filter"] is not None


@pytest.mark.asyncio
async def test_hybrid_search_without_filter_passes_none():
    mock_client = AsyncMock()
    mock_client.query_points.return_value = MagicMock(points=[])

    with (
        patch("src.search.hybrid.embed_dense_query", new_callable=AsyncMock, return_value=[0.0] * 768),
        patch("src.search.hybrid.embed_sparse_async", new_callable=AsyncMock, return_value=([0], [1.0])),
    ):
        await hybrid_search(mock_client, "질문", top_k=5)

    call_kwargs = mock_client.query_points.call_args.kwargs
    assert call_kwargs.get("query_filter") is None
