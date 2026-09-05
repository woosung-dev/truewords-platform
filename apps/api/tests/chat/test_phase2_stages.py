"""Phase 2 Stage 단위 테스트 — QueryRewrite, Rerank, SafetyOutput."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.pipeline.stages.query_rewrite import QueryRewriteStage
from app.modules.chat.pipeline.stages.rerank import RerankStage
from app.modules.chat.pipeline.stages.safety_output import SafetyOutputStage
from app.modules.chat.schemas import ChatRequest
from app.modules.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
)
from app.modules.search.hybrid import SearchResult


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
                "app.modules.chat.pipeline.stages.query_rewrite.rewrite_query",
                new_callable=AsyncMock, return_value="재작성된 질문",
            ),
            patch(
                "app.modules.chat.pipeline.stages.query_rewrite.embed_dense_query",
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

    @pytest.mark.asyncio
    async def test_followup_turn_uses_condense(self) -> None:
        """멀티턴 — 후속 턴은 rewrite_query 대신 condense_query 로 문맥 해소."""
        from unittest.mock import MagicMock

        from app.modules.chat.models import MessageRole

        prev = MagicMock()
        prev.role = MessageRole.USER
        prev.content = "효자란 무엇인가요?"

        ctx = ChatContext(request=ChatRequest(query="그럼 어떻게 실천하나요?"))
        ctx.runtime_config = _make_runtime(query_rewrite_enabled=True)
        ctx.query_embedding = [0.1] * 10
        ctx.original_query_embedding = [0.1] * 10
        ctx.history = [prev]

        with (
            patch(
                "app.modules.chat.pipeline.stages.query_rewrite.condense_query",
                new_callable=AsyncMock, return_value="효자 실천 방법은 무엇인가요?",
            ) as mock_condense,
            patch(
                "app.modules.chat.pipeline.stages.query_rewrite.rewrite_query",
                new_callable=AsyncMock,
            ) as mock_rewrite,
            patch(
                "app.modules.chat.pipeline.stages.query_rewrite.embed_dense_query",
                new_callable=AsyncMock, return_value=[0.2] * 10,
            ),
        ):
            result = await QueryRewriteStage().execute(ctx)

        mock_rewrite.assert_not_awaited()
        mock_condense.assert_awaited_once()
        # rewrite_enabled=True → 용어 변환 결합 호출 (term_rewrite=True)
        assert mock_condense.call_args.kwargs["term_rewrite"] is True
        assert result.search_query == "효자 실천 방법은 무엇인가요?"
        assert result.rewritten_query == "효자 실천 방법은 무엇인가요?"
        assert result.query_embedding == [0.2] * 10
        # 캐시 일관성 — 원본 임베딩은 불변
        assert result.original_query_embedding == [0.1] * 10

    @pytest.mark.asyncio
    async def test_followup_condense_independent_of_rewrite_toggle(self) -> None:
        """condense 게이트는 query_rewrite_enabled 토글과 독립 —
        기본 봇(rewrite_enabled=False)에서도 멀티턴 문맥 해소가 동작해야 한다."""
        from unittest.mock import MagicMock

        from app.modules.chat.models import MessageRole

        prev = MagicMock()
        prev.role = MessageRole.USER
        prev.content = "효자란?"

        ctx = ChatContext(request=ChatRequest(query="그럼 어떻게?"))
        ctx.runtime_config = _make_runtime(query_rewrite_enabled=False)
        ctx.history = [prev]

        with (
            patch(
                "app.modules.chat.pipeline.stages.query_rewrite.condense_query",
                new_callable=AsyncMock, return_value="효자 실천 방법",
            ) as mock_condense,
            patch(
                "app.modules.chat.pipeline.stages.query_rewrite.embed_dense_query",
                new_callable=AsyncMock, return_value=[0.2] * 10,
            ),
        ):
            result = await QueryRewriteStage().execute(ctx)

        mock_condense.assert_awaited_once()
        assert mock_condense.call_args.kwargs["term_rewrite"] is False
        assert result.search_query == "효자 실천 방법"

    @pytest.mark.asyncio
    async def test_followup_condense_fallback_keeps_original(self) -> None:
        """condense 가 원문을 그대로 반환하면 (독립 질문/실패) 재임베딩 없음."""
        from unittest.mock import MagicMock

        from app.modules.chat.models import MessageRole

        prev = MagicMock()
        prev.role = MessageRole.USER
        prev.content = "효자란?"

        ctx = ChatContext(request=ChatRequest(query="독립적인 질문입니다"))
        ctx.runtime_config = _make_runtime(query_rewrite_enabled=False)
        ctx.query_embedding = [0.1] * 10
        ctx.history = [prev]

        with (
            patch(
                "app.modules.chat.pipeline.stages.query_rewrite.condense_query",
                new_callable=AsyncMock, return_value="독립적인 질문입니다",
            ),
            patch(
                "app.modules.chat.pipeline.stages.query_rewrite.embed_dense_query",
                new_callable=AsyncMock,
            ) as mock_embed,
        ):
            result = await QueryRewriteStage().execute(ctx)

        mock_embed.assert_not_awaited()
        assert result.search_query == "독립적인 질문입니다"
        assert result.rewritten_query is None
        assert result.query_embedding == [0.1] * 10


class TestRerankStage:
    @pytest.mark.asyncio
    async def test_reranks_when_enabled(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.runtime_config = _make_runtime(rerank_enabled=True)
        ctx.results = [_make_result(0.5), _make_result(0.3)]

        reranked = [_make_result(0.5, rerank_score=0.9), _make_result(0.3, rerank_score=0.7)]
        with patch(
            "app.modules.chat.pipeline.stages.rerank.rerank",
            new_callable=AsyncMock, return_value=reranked,
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


class TestSafetyOutputStage:
    @pytest.mark.asyncio
    async def test_applies_safety_layer(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.answer = "raw answer"

        with patch(
            "app.modules.chat.pipeline.stages.safety_output.apply_safety_layer",
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
