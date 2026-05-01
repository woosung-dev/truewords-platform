"""match_snippets_to_chunks 의 --collection 인자 전파 검증 (PR 6.5).

cascading_search 호출 시 collection_name kwarg 가 정확히 전달되는지 mock 으로 확인.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scripts.match_snippets_to_chunks import match_query_entry, search_for_snippet


@pytest.mark.asyncio
async def test_search_for_snippet_passes_collection_explicit():
    with patch(
        "src.search.cascading.cascading_search",
        new=AsyncMock(return_value=[]),
    ) as mock_search, patch(
        "src.qdrant_client.get_raw_client",
        return_value=MagicMock(),
    ):
        await search_for_snippet(
            "샘플", sources=["U"], top_k=20, collection_name="malssum_poc_v5",
        )

    assert mock_search.call_count == 1
    kwargs = mock_search.call_args.kwargs
    assert kwargs["collection_name"] == "malssum_poc_v5"
    assert kwargs["top_k"] == 20


@pytest.mark.asyncio
async def test_search_for_snippet_default_collection_none():
    with patch(
        "src.search.cascading.cascading_search",
        new=AsyncMock(return_value=[]),
    ) as mock_search, patch(
        "src.qdrant_client.get_raw_client",
        return_value=MagicMock(),
    ):
        await search_for_snippet("샘플", sources=["U"], top_k=20)

    kwargs = mock_search.call_args.kwargs
    assert kwargs["collection_name"] is None


@pytest.mark.asyncio
async def test_match_query_entry_propagates_collection():
    """match_query_entry → search_for_snippet 으로 collection_name 전달."""
    query_entry = {
        "id": "f01",
        "expected_snippets": [{"file": "원리강론.txt", "snippet": "샘플 인용"}],
    }
    with patch(
        "src.search.cascading.cascading_search",
        new=AsyncMock(return_value=[]),
    ) as mock_search, patch(
        "src.qdrant_client.get_raw_client",
        return_value=MagicMock(),
    ):
        await match_query_entry(
            query_entry, sources=["U"], top_k=20, collection_name="custom_v6",
        )

    assert mock_search.call_args.kwargs["collection_name"] == "custom_v6"
