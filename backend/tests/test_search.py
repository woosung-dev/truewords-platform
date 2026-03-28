from unittest.mock import MagicMock, patch
from src.search.hybrid import hybrid_search, SearchResult


def _make_mock_point(text: str, volume: str, score: float):
    point = MagicMock()
    point.payload = {"text": text, "volume": volume, "chunk_index": 0}
    point.score = score
    return point


def test_hybrid_search_returns_search_results():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.points = [
        _make_mock_point("하나님의 사랑", "vol_001", 0.95),
        _make_mock_point("참부모님 말씀", "vol_002", 0.88),
    ]
    mock_client.query_points.return_value = mock_response

    with (
        patch("src.search.hybrid.embed_dense_query", return_value=[0.1] * 768),
        patch("src.search.hybrid.embed_sparse", return_value=([1, 2], [0.5, 0.3])),
    ):
        results = hybrid_search(mock_client, "하나님 사랑이란", top_k=10)

    assert len(results) == 2
    assert all(isinstance(r, SearchResult) for r in results)
    assert results[0].text == "하나님의 사랑"
    assert results[0].volume == "vol_001"
    assert results[0].score == 0.95


def test_hybrid_search_calls_query_points_with_rrf():
    mock_client = MagicMock()
    mock_client.query_points.return_value = MagicMock(points=[])

    with (
        patch("src.search.hybrid.embed_dense_query", return_value=[0.0] * 768),
        patch("src.search.hybrid.embed_sparse", return_value=([0], [1.0])),
    ):
        hybrid_search(mock_client, "질문", top_k=5)

    call_kwargs = mock_client.query_points.call_args.kwargs
    assert call_kwargs["limit"] == 5
    assert call_kwargs["query"] is not None
