"""cascading_search 비동기 테스트."""

import pytest
from unittest.mock import AsyncMock, patch
from src.search.cascading import cascading_search, SearchTier, CascadingConfig
from src.search.hybrid import SearchResult

# cascading_search가 임베딩을 직접 계산하므로 모든 테스트에서 mock 필요
_DENSE_PATCH = "src.search.cascading.embed_dense_query"
_SPARSE_PATCH = "src.search.cascading.embed_sparse_async"


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


@pytest.mark.asyncio
async def test_cascading_returns_first_tier_when_sufficient():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=2, score_threshold=0.7),
        SearchTier(sources=["B"], min_results=1, score_threshold=0.5),
    ])
    a_results = _make_results("A", [0.95, 0.85, 0.80])

    with (
        patch("src.search.cascading.hybrid_search", new_callable=AsyncMock) as mock_search,
        patch(_DENSE_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
        patch(_SPARSE_PATCH, new_callable=AsyncMock, return_value=([1], [0.5])),
    ):
        mock_search.return_value = a_results
        results = await cascading_search(AsyncMock(), "질문", config, top_k=10)

    assert mock_search.call_count == 1
    assert len(results) >= 2
    assert all(r.source == "A" for r in results)


@pytest.mark.asyncio
async def test_cascading_falls_back_to_next_tier():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=3, score_threshold=0.75),
        SearchTier(sources=["B"], min_results=2, score_threshold=0.60),
    ])
    a_results = _make_results("A", [0.80])
    b_results = _make_results("B", [0.70, 0.65, 0.62])

    with (
        patch("src.search.cascading.hybrid_search", new_callable=AsyncMock) as mock_search,
        patch(_DENSE_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
        patch(_SPARSE_PATCH, new_callable=AsyncMock, return_value=([1], [0.5])),
    ):
        mock_search.side_effect = [a_results, b_results]
        results = await cascading_search(AsyncMock(), "질문", config, top_k=10)

    assert mock_search.call_count == 2
    sources = {r.source for r in results}
    assert "A" in sources
    assert "B" in sources


@pytest.mark.asyncio
async def test_cascading_filters_by_score_threshold():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=2, score_threshold=0.80),
    ])
    a_results = _make_results("A", [0.95, 0.85, 0.60, 0.50])

    with (
        patch("src.search.cascading.hybrid_search", new_callable=AsyncMock) as mock_search,
        patch(_DENSE_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
        patch(_SPARSE_PATCH, new_callable=AsyncMock, return_value=([1], [0.5])),
    ):
        mock_search.return_value = a_results
        results = await cascading_search(AsyncMock(), "질문", config, top_k=10)

    assert all(r.score >= 0.80 for r in results)
    assert len(results) == 2


@pytest.mark.asyncio
async def test_cascading_returns_empty_when_all_tiers_empty():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=1, score_threshold=0.80),
        SearchTier(sources=["B"], min_results=1, score_threshold=0.60),
    ])

    with (
        patch("src.search.cascading.hybrid_search", new_callable=AsyncMock) as mock_search,
        patch(_DENSE_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
        patch(_SPARSE_PATCH, new_callable=AsyncMock, return_value=([1], [0.5])),
    ):
        mock_search.return_value = []
        results = await cascading_search(AsyncMock(), "질문", config, top_k=10)

    assert results == []


@pytest.mark.asyncio
async def test_cascading_respects_top_k():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=1, score_threshold=0.50),
    ])
    a_results = _make_results("A", [0.95, 0.90, 0.85, 0.80, 0.75])

    with (
        patch("src.search.cascading.hybrid_search", new_callable=AsyncMock) as mock_search,
        patch(_DENSE_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
        patch(_SPARSE_PATCH, new_callable=AsyncMock, return_value=([1], [0.5])),
    ):
        mock_search.return_value = a_results
        results = await cascading_search(AsyncMock(), "질문", config, top_k=3)

    assert len(results) == 3


@pytest.mark.asyncio
async def test_cascading_sorts_by_score_descending():
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=3, score_threshold=0.60),
        SearchTier(sources=["B"], min_results=1, score_threshold=0.50),
    ])
    a_results = _make_results("A", [0.70])
    b_results = _make_results("B", [0.90, 0.60])

    with (
        patch("src.search.cascading.hybrid_search", new_callable=AsyncMock) as mock_search,
        patch(_DENSE_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
        patch(_SPARSE_PATCH, new_callable=AsyncMock, return_value=([1], [0.5])),
    ):
        mock_search.side_effect = [a_results, b_results]
        results = await cascading_search(AsyncMock(), "질문", config, top_k=10)

    scores = [r.score for r in results]
    assert scores == sorted(scores, reverse=True)


# ── Task 1.3.2: 티어별 실패 격리 테스트 ──────────────────────────────────────

from src.search.exceptions import SearchFailedError  # noqa: E402


@pytest.mark.asyncio
async def test_cascading_search_tier_fallback_on_first_tier_failure():
    """tier 0이 실패하면 tier 1로 fallback (예외 전파 안 함)."""
    config = CascadingConfig(
        tiers=[
            SearchTier(sources=["A"], min_results=3, score_threshold=0.75),
            SearchTier(sources=["B"], min_results=3, score_threshold=0.75),
        ]
    )
    mock_client = AsyncMock()

    call_count = {"n": 0}

    async def fake_hybrid_search(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise ConnectionError("Qdrant timeout")
        return _make_results("B", [0.90, 0.85, 0.80, 0.76, 0.75])

    with patch("src.search.cascading.hybrid_search", side_effect=fake_hybrid_search):
        with patch(
            "src.search.cascading.embed_dense_query",
            new_callable=AsyncMock,
            return_value=[0.1] * 3072,
        ):
            with patch(
                "src.search.cascading.embed_sparse_async",
                new_callable=AsyncMock,
                return_value=([1], [0.5]),
            ):
                results = await cascading_search(
                    client=mock_client,
                    query="test",
                    config=config,
                    top_k=5,
                )

    assert call_count["n"] == 2, "tier 0 실패 후 tier 1을 시도해야 함"
    assert len(results) > 0, "tier 1에서 결과를 받아야 함"


@pytest.mark.asyncio
async def test_cascading_search_raises_search_failed_when_all_tiers_fail():
    """모든 tier가 실패하면 SearchFailedError raise."""
    config = CascadingConfig(
        tiers=[
            SearchTier(sources=["A"], min_results=3),
            SearchTier(sources=["B"], min_results=3),
        ]
    )
    mock_client = AsyncMock()

    async def always_fail(*args, **kwargs):
        raise ConnectionError("Qdrant down")

    with patch("src.search.cascading.hybrid_search", side_effect=always_fail):
        with patch(
            "src.search.cascading.embed_dense_query",
            new_callable=AsyncMock,
            return_value=[0.1] * 3072,
        ):
            with patch(
                "src.search.cascading.embed_sparse_async",
                new_callable=AsyncMock,
                return_value=([1], [0.5]),
            ):
                with pytest.raises(SearchFailedError):
                    await cascading_search(
                        client=mock_client,
                        query="test",
                        config=config,
                    )


@pytest.mark.asyncio
async def test_cascading_search_normal_path_first_tier_succeeds():
    """기존 정상 동작: tier 0 성공 시 바로 반환 (fallback 안 함)."""
    config = CascadingConfig(
        tiers=[
            SearchTier(sources=["A"], min_results=3, score_threshold=0.75),
            SearchTier(sources=["B"], min_results=3, score_threshold=0.75),
        ]
    )
    mock_client = AsyncMock()

    call_count = {"n": 0}

    async def fake_hybrid_search(*args, **kwargs):
        call_count["n"] += 1
        return _make_results("A", [0.95, 0.90, 0.85, 0.80, 0.76])

    with patch("src.search.cascading.hybrid_search", side_effect=fake_hybrid_search):
        with patch(
            "src.search.cascading.embed_dense_query",
            new_callable=AsyncMock,
            return_value=[0.1] * 3072,
        ):
            with patch(
                "src.search.cascading.embed_sparse_async",
                new_callable=AsyncMock,
                return_value=([1], [0.5]),
            ):
                results = await cascading_search(
                    client=mock_client,
                    query="test",
                    config=config,
                )

    assert call_count["n"] == 1, "tier 0 성공 시 tier 1 호출 안 함"
    assert len(results) >= 3
