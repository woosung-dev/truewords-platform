"""hybrid_search 비동기 테스트.

raw httpx 전환 (PR-B) 이후 ``RawQdrantClient.query_points`` 가 ``list[QdrantPoint]``
를 직접 반환하므로, mock 도 리스트를 반환하도록 단순화되었다.
"""

import pytest
from unittest.mock import AsyncMock, patch
from src.qdrant.raw_client import QdrantPoint
from src.search.hybrid import hybrid_search, SearchResult


def _make_point(text: str, volume: str, score: float, source: str = "") -> QdrantPoint:
    return QdrantPoint(
        id=f"{volume}-0",
        score=score,
        payload={"text": text, "volume": volume, "chunk_index": 0, "source": source},
    )


@pytest.mark.asyncio
async def test_hybrid_search_returns_search_results():
    mock_client = AsyncMock()
    mock_client.query_points.return_value = [
        _make_point("하나님의 사랑", "vol_001", 0.95),
        _make_point("참부모님 말씀", "vol_002", 0.88),
    ]

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
    mock_client.query_points.return_value = [
        _make_point("A 말씀", "vol_001", 0.90, "A"),
    ]

    with (
        patch("src.search.hybrid.embed_dense_query", new_callable=AsyncMock, return_value=[0.1] * 768),
        patch("src.search.hybrid.embed_sparse_async", new_callable=AsyncMock, return_value=([1, 2], [0.5, 0.3])),
    ):
        results = await hybrid_search(mock_client, "질문", top_k=10, source_filter=["A"])

    assert len(results) == 1
    call_kwargs = mock_client.query_points.call_args.kwargs
    # build_filter 결과 dict (must.match.any) 가 전달되어야 함
    assert call_kwargs["query_filter"] is not None
    must = call_kwargs["query_filter"]["must"]
    assert must[0]["key"] == "source"
    assert must[0]["match"]["any"] == ["A"]


@pytest.mark.asyncio
async def test_hybrid_search_without_filter_passes_none():
    mock_client = AsyncMock()
    mock_client.query_points.return_value = []

    with (
        patch("src.search.hybrid.embed_dense_query", new_callable=AsyncMock, return_value=[0.0] * 768),
        patch("src.search.hybrid.embed_sparse_async", new_callable=AsyncMock, return_value=([0], [1.0])),
    ):
        await hybrid_search(mock_client, "질문", top_k=5)

    call_kwargs = mock_client.query_points.call_args.kwargs
    assert call_kwargs.get("query_filter") is None


@pytest.mark.asyncio
async def test_hybrid_search_uses_rrf_fusion_with_dense_and_sparse_prefetch():
    """raw httpx body: query=fusion_rrf(), prefetch=[dense, sparse]."""
    mock_client = AsyncMock()
    mock_client.query_points.return_value = []

    with (
        patch("src.search.hybrid.embed_dense_query", new_callable=AsyncMock, return_value=[0.1] * 4),
        patch(
            "src.search.hybrid.embed_sparse_async",
            new_callable=AsyncMock,
            return_value=([7, 9], [0.4, 0.6]),
        ),
    ):
        await hybrid_search(mock_client, "질문", top_k=10)

    kwargs = mock_client.query_points.call_args.kwargs
    assert kwargs["query"] == {"fusion": "rrf"}
    pre = kwargs["prefetch"]
    assert len(pre) == 2
    assert pre[0]["using"] == "dense"
    assert pre[0]["limit"] == 50
    assert pre[1]["using"] == "sparse"
    assert pre[1]["query"] == {"indices": [7, 9], "values": [0.4, 0.6]}
