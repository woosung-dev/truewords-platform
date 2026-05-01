"""evaluate_threshold 의 --collection / --sources 인자 전파 검증 (PR 6.5).

* collection_name 이 cascading_search 에 정확히 전달되는지.
* sources_override 가 chatbot_id 분기를 우회하는지.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scripts.evaluate_threshold import _build_eval_cascading_config, run_search


@pytest.mark.asyncio
async def test_build_eval_config_uses_sources_override_when_present():
    """sources_override 명시 시 chatbot_id 무시하고 단일 SearchTier 사용."""
    config = await _build_eval_cascading_config(
        chatbot_id="신학/원리 전문 봇",
        sources_override=["U"],
    )
    assert len(config.tiers) == 1
    assert config.tiers[0].sources == ["U"]
    assert config.tiers[0].score_threshold == 0.0


@pytest.mark.asyncio
async def test_build_eval_config_default_when_no_sources_no_chatbot():
    config = await _build_eval_cascading_config(chatbot_id=None, sources_override=None)
    assert len(config.tiers) == 1
    assert config.tiers[0].sources == ["A", "B", "C"]


@pytest.mark.asyncio
async def test_run_search_passes_collection_to_cascading():
    with patch(
        "src.search.cascading.cascading_search",
        new=AsyncMock(return_value=[]),
    ) as mock_search, patch(
        "src.qdrant_client.get_raw_client",
        return_value=MagicMock(),
    ):
        await run_search(
            "질문",
            top_k=10,
            rerank_model="none",
            chatbot_id=None,
            collection_name="malssum_poc_v5",
            sources=["U"],
        )

    assert mock_search.call_count == 1
    kwargs = mock_search.call_args.kwargs
    assert kwargs["collection_name"] == "malssum_poc_v5"
    # cascading top-K 는 max(top_k * 5, 50)
    assert kwargs["top_k"] == 50


@pytest.mark.asyncio
async def test_run_search_default_collection_none():
    with patch(
        "src.search.cascading.cascading_search",
        new=AsyncMock(return_value=[]),
    ) as mock_search, patch(
        "src.qdrant_client.get_raw_client",
        return_value=MagicMock(),
    ):
        await run_search("질문", rerank_model="none", sources=["U"])

    assert mock_search.call_args.kwargs["collection_name"] is None


@pytest.mark.asyncio
async def test_run_search_no_rerank_when_model_none():
    """rerank_model='none' → reranker 호출 없음."""
    with patch(
        "src.search.cascading.cascading_search",
        new=AsyncMock(return_value=[]),
    ), patch(
        "src.qdrant_client.get_raw_client",
        return_value=MagicMock(),
    ), patch(
        "src.search.rerank.get_reranker",
    ) as mock_reranker:
        await run_search("질문", rerank_model="none", sources=["U"])

    mock_reranker.assert_not_called()
