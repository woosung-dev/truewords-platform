"""임베딩 중복 계산 최적화 테스트 — 임베딩 재사용 검증."""

import pytest
from unittest.mock import AsyncMock, patch

from src.search.cascading import cascading_search, CascadingConfig, SearchTier
from src.search.hybrid import SearchResult


def _make_search_results(count: int = 3) -> list[SearchResult]:
    return [
        SearchResult(
            text=f"말씀 {i}", volume=f"vol_{i:03d}", chunk_index=i,
            score=0.9 - i * 0.05, source="A",
        )
        for i in range(count)
    ]


class TestEmbeddingReuse:
    """임베딩이 1회만 계산되는지 검증."""

    @pytest.mark.asyncio
    @patch("src.search.cascading.embed_sparse_async", new_callable=AsyncMock)
    @patch("src.search.cascading.embed_dense_query", new_callable=AsyncMock)
    @patch("src.search.hybrid.embed_sparse_async", new_callable=AsyncMock)
    @patch("src.search.hybrid.embed_dense_query", new_callable=AsyncMock)
    async def test_cascading_computes_embeddings_once(
        self, mock_hybrid_dense, mock_hybrid_sparse, mock_cascade_dense, mock_cascade_sparse,
    ) -> None:
        """2개 티어에서 임베딩이 cascading에서 1회만 계산되고 hybrid에서는 스킵."""
        mock_cascade_dense.return_value = [0.1] * 3072
        mock_cascade_sparse.return_value = ([1, 2, 3], [0.5, 0.3, 0.2])

        client = AsyncMock()
        mock_response = AsyncMock()
        mock_response.points = []
        client.query_points.return_value = mock_response

        config = CascadingConfig(tiers=[
            SearchTier(sources=["A"], min_results=5, score_threshold=0.7),
            SearchTier(sources=["B"], min_results=3, score_threshold=0.6),
        ])

        await cascading_search(client, "테스트 질문", config, top_k=10)

        # cascading에서 1회만 계산
        mock_cascade_dense.assert_awaited_once()
        mock_cascade_sparse.assert_awaited_once()
        # hybrid 내부에서는 계산하지 않음 (주입받았으므로)
        mock_hybrid_dense.assert_not_awaited()
        mock_hybrid_sparse.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("src.search.cascading.embed_sparse_async", new_callable=AsyncMock)
    @patch("src.search.cascading.embed_dense_query", new_callable=AsyncMock)
    @patch("src.search.hybrid.embed_sparse_async", new_callable=AsyncMock)
    @patch("src.search.hybrid.embed_dense_query", new_callable=AsyncMock)
    async def test_dense_embedding_injection_skips_recomputation(
        self, mock_hybrid_dense, mock_hybrid_sparse, mock_cascade_dense, mock_cascade_sparse,
    ) -> None:
        """���부에서 dense_embedding을 주입하면 cascading에서도 재계산 스킵."""
        mock_cascade_sparse.return_value = ([1, 2], [0.5, 0.3])
        pre_computed = [0.2] * 3072

        client = AsyncMock()
        mock_response = AsyncMock()
        mock_response.points = []
        client.query_points.return_value = mock_response

        config = CascadingConfig(tiers=[SearchTier(sources=["A"])])

        await cascading_search(
            client, "질문", config, top_k=10,
            dense_embedding=pre_computed,
        )

        # dense는 주입했으므로 계산 안 함
        mock_cascade_dense.assert_not_awaited()
        # sparse는 1회 계산
        mock_cascade_sparse.assert_awaited_once()
        # hybrid 내부에서도 계산 안 함
        mock_hybrid_dense.assert_not_awaited()
        mock_hybrid_sparse.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("src.search.hybrid.embed_sparse_async", new_callable=AsyncMock)
    @patch("src.search.hybrid.embed_dense_query", new_callable=AsyncMock)
    async def test_hybrid_search_backward_compatible(
        self, mock_dense, mock_sparse,
    ) -> None:
        """기존 방식(임베딩 미주입)도 여전히 동작."""
        mock_dense.return_value = [0.1] * 3072
        mock_sparse.return_value = ([1], [0.5])

        client = AsyncMock()
        mock_response = AsyncMock()
        mock_response.points = []
        client.query_points.return_value = mock_response

        from src.search.hybrid import hybrid_search
        await hybrid_search(client, "질문", top_k=5)

        # 주입 안 하면 내부에서 계산
        mock_dense.assert_awaited_once()
        mock_sparse.assert_awaited_once()
