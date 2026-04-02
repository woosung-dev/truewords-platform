from unittest.mock import MagicMock, patch
from src.search.cascading import (
    cascading_search,
    SearchTier,
    CascadingConfig,
)
from src.search.hybrid import SearchResult


def _make_results(source: str, scores: list[float]) -> list[SearchResult]:
    return [
        SearchResult(
            text=f"{source} 말씀 {i}",
            volume=f"vol_{source}_{i}",
            chunk_index=i,
            score=s,
            source=source,
        )
        for i, s in enumerate(scores)
    ]


def test_cascading_returns_first_tier_when_sufficient():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=2, score_threshold=0.7),
        SearchTier(sources=["B"], min_results=1, score_threshold=0.5),
    ])
    a_results = _make_results("A", [0.95, 0.85, 0.80])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.return_value = a_results
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    assert mock_search.call_count == 1
    assert len(results) >= 2
    assert all(r.source == "A" for r in results)


def test_cascading_falls_back_to_next_tier():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=3, score_threshold=0.75),
        SearchTier(sources=["B"], min_results=2, score_threshold=0.60),
    ])
    a_results = _make_results("A", [0.80])
    b_results = _make_results("B", [0.70, 0.65, 0.62])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.side_effect = [a_results, b_results]
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    assert mock_search.call_count == 2
    sources = {r.source for r in results}
    assert "A" in sources
    assert "B" in sources


def test_cascading_filters_by_score_threshold():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=2, score_threshold=0.80),
    ])
    a_results = _make_results("A", [0.95, 0.85, 0.60, 0.50])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.return_value = a_results
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    assert all(r.score >= 0.80 for r in results)
    assert len(results) == 2


def test_cascading_returns_empty_when_all_tiers_empty():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=1, score_threshold=0.80),
        SearchTier(sources=["B"], min_results=1, score_threshold=0.60),
    ])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.return_value = []
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    assert results == []


def test_cascading_respects_top_k():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=1, score_threshold=0.50),
    ])
    a_results = _make_results("A", [0.95, 0.90, 0.85, 0.80, 0.75])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.return_value = a_results
        results = cascading_search(MagicMock(), "질문", config, top_k=3)

    assert len(results) == 3


def test_cascading_sorts_by_score_descending():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=3, score_threshold=0.60),
        SearchTier(sources=["B"], min_results=1, score_threshold=0.50),
    ])
    a_results = _make_results("A", [0.70])
    b_results = _make_results("B", [0.90, 0.60])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.side_effect = [a_results, b_results]
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    scores = [r.score for r in results]
    assert scores == sorted(scores, reverse=True)
