"""Phase 2 Stage 단위 테스트 — QueryRewrite, Rerank, SafetyOutput."""

from __future__ import annotations

import logging

import pytest
from unittest.mock import AsyncMock, patch

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.query_rewrite import QueryRewriteStage
from src.chat.pipeline.stages.rerank import RerankStage
from src.chat.pipeline.stages.safety_output import SafetyOutputStage
from src.chat.schemas import ChatRequest
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
)
from src.search.hybrid import SearchResult


def _make_runtime(rerank_enabled=True, query_rewrite_enabled=True):
    return ChatbotRuntimeConfig(
        chatbot_id="t",
        name="t",
        search=SearchModeConfig(mode="cascading"),
        generation=GenerationConfig(system_prompt="t"),
        retrieval=RetrievalConfig(
            rerank_enabled=rerank_enabled,
            query_rewrite_enabled=query_rewrite_enabled,
        ),
        safety=SafetyConfig(),
    )


def _make_result(score=0.5, rerank_score=None):
    return SearchResult(
        text="t", volume="v", chunk_index=0, score=score,
        source="A", rerank_score=rerank_score,
    )


class TestQueryRewriteStage:
    @pytest.mark.asyncio
    async def test_rewrites_when_enabled(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="원래 질문"))
        ctx.runtime_config = _make_runtime(query_rewrite_enabled=True)
        ctx.query_embedding = [0.1] * 10

        with (
            patch(
                "src.chat.pipeline.stages.query_rewrite.rewrite_query",
                new_callable=AsyncMock, return_value="재작성된 질문",
            ),
            patch(
                "src.chat.pipeline.stages.query_rewrite.embed_dense_query",
                new_callable=AsyncMock, return_value=[0.2] * 10,
            ),
        ):
            result = await QueryRewriteStage().execute(ctx)

        assert result.search_query == "재작성된 질문"
        assert result.rewritten_query == "재작성된 질문"
        assert result.query_embedding == [0.2] * 10

    @pytest.mark.asyncio
    async def test_skips_when_disabled(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="질문"))
        ctx.runtime_config = _make_runtime(query_rewrite_enabled=False)

        result = await QueryRewriteStage().execute(ctx)
        assert result.search_query == "질문"
        assert result.rewritten_query is None

    @pytest.mark.asyncio
    async def test_skips_when_no_runtime_config(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="질문"))
        result = await QueryRewriteStage().execute(ctx)
        assert result.search_query == "질문"


class TestRerankStage:
    @pytest.mark.asyncio
    async def test_reranks_when_enabled(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.runtime_config = _make_runtime(rerank_enabled=True)
        ctx.results = [_make_result(0.5), _make_result(0.3)]

        reranked = [_make_result(0.5, rerank_score=0.9), _make_result(0.3, rerank_score=0.7)]
        with patch(
            "src.chat.pipeline.stages.rerank.rerank",
            new=AsyncMock(return_value=reranked),
        ):
            result = await RerankStage().execute(ctx)

        assert result.reranked is True
        assert result.rerank_latency_ms >= 0

    @pytest.mark.asyncio
    async def test_truncates_to_10_when_disabled(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.runtime_config = _make_runtime(rerank_enabled=False)
        ctx.results = [_make_result()] * 15

        result = await RerankStage().execute(ctx)
        assert len(result.results) == 10
        assert result.reranked is False

    @pytest.mark.asyncio
    async def test_emits_rerank_score_dist_when_reranked(self, caplog) -> None:
        """PR 6: rerank_score_dist 로그가 점수 분포 + latency 와 함께 emit."""
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.runtime_config = _make_runtime(rerank_enabled=True)
        ctx.results = [_make_result(0.5), _make_result(0.4), _make_result(0.3)]

        reranked = [
            _make_result(0.5, rerank_score=0.92),
            _make_result(0.4, rerank_score=0.71),
            _make_result(0.3, rerank_score=0.45),
        ]

        with caplog.at_level(logging.INFO, logger="src.chat.pipeline.stages.rerank"):
            with patch(
                "src.chat.pipeline.stages.rerank.rerank",
                new=AsyncMock(return_value=reranked),
            ):
                await RerankStage().execute(ctx)

        records = [r for r in caplog.records if r.message == "rerank_score_dist"]
        assert len(records) == 1, f"expected 1 rerank_score_dist log, got {len(records)}"
        rec = records[0]
        assert rec.n_input == 3
        assert rec.n_output == 3
        assert rec.score_top == 0.92
        assert rec.score_bottom == 0.45
        assert rec.score_p50 == 0.71  # 정렬된 [0.92, 0.71, 0.45] 중간
        assert rec.latency_ms >= 0
        assert ctx.results_before_rerank == [_make_result(0.5), _make_result(0.4), _make_result(0.3)]

    @pytest.mark.asyncio
    async def test_skips_log_when_all_rerank_scores_none(self, caplog) -> None:
        """PR 6: reranker 가 graceful degrade (rerank_score=None) 한 경우 로그 생략."""
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.runtime_config = _make_runtime(rerank_enabled=True)
        ctx.results = [_make_result(0.5)]

        # reranker 가 graceful degradation: 점수 없는 원본 그대로 반환
        degraded = [_make_result(0.5, rerank_score=None)]

        with caplog.at_level(logging.INFO, logger="src.chat.pipeline.stages.rerank"):
            with patch(
                "src.chat.pipeline.stages.rerank.rerank",
                new=AsyncMock(return_value=degraded),
            ):
                await RerankStage().execute(ctx)

        assert not [r for r in caplog.records if r.message == "rerank_score_dist"]

    @pytest.mark.asyncio
    async def test_no_log_when_rerank_disabled(self, caplog) -> None:
        """PR 6: rerank_enabled=False 이면 stage 가 단순 truncate, 로그 없음."""
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.runtime_config = _make_runtime(rerank_enabled=False)
        ctx.results = [_make_result()] * 5

        with caplog.at_level(logging.INFO, logger="src.chat.pipeline.stages.rerank"):
            await RerankStage().execute(ctx)

        assert not [r for r in caplog.records if r.message == "rerank_score_dist"]


class TestSafetyOutputStage:
    @pytest.mark.asyncio
    async def test_applies_safety_layer(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.answer = "raw answer"

        with patch(
            "src.chat.pipeline.stages.safety_output.apply_safety_layer",
            new_callable=AsyncMock, return_value="safe answer",
        ):
            result = await SafetyOutputStage().execute(ctx)

        assert result.answer == "safe answer"

    @pytest.mark.asyncio
    async def test_noop_when_no_answer(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.answer = None

        result = await SafetyOutputStage().execute(ctx)
        assert result.answer is None
