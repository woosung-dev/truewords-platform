"""CacheCheckStage 단위 테스트."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.cache.schemas import CacheHit
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.cache_check import CacheCheckStage
from src.chat.schemas import ChatRequest


def _make_hit(answer: str = "원본 답변") -> CacheHit:
    return CacheHit(
        question="질문",
        answer=answer,
        sources=[{"volume": "1권", "text": "본문", "score": 0.9, "source": "A"}],
        score=0.95,
        created_at=1700000000.0,
    )


class TestCacheCheckStage:
    @pytest.mark.asyncio
    async def test_no_op_when_no_cache_service(self) -> None:
        stage = CacheCheckStage(cache_service=None)
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.query_embedding = [0.1] * 1536

        result = await stage.execute(ctx)
        assert result.cache_hit is False
        assert result.cache_response is None

    @pytest.mark.asyncio
    async def test_sets_cache_hit_on_match(self) -> None:
        cache_service = MagicMock()
        cache_service.check_cache = AsyncMock(return_value=_make_hit())
        stage = CacheCheckStage(cache_service=cache_service)
        ctx = ChatContext(request=ChatRequest(query="q", chatbot_id="cid"))
        ctx.query_embedding = [0.1] * 1536

        with patch(
            "src.chat.pipeline.stages.cache_check.apply_safety_layer",
            new_callable=AsyncMock,
            return_value="안전 답변",
        ):
            result = await stage.execute(ctx)

        assert result.cache_hit is True
        assert result.cache_response is not None
        assert result.cache_response.answer == "안전 답변"
        # corpus_updated_at 이 None 또는 0.0 이면 cache 가 corpus 검증 생략 (모든
        # cache valid). ChatContext 기본값 0.0 → `or None` 처리되어 None 전달.
        cache_service.check_cache.assert_awaited_once_with(
            [0.1] * 1536, "cid", corpus_updated_at=None
        )

    @pytest.mark.asyncio
    async def test_applies_safety_layer(self) -> None:
        cache_service = MagicMock()
        cache_service.check_cache = AsyncMock(return_value=_make_hit("raw"))
        stage = CacheCheckStage(cache_service=cache_service)
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.query_embedding = [0.1] * 1536

        with patch(
            "src.chat.pipeline.stages.cache_check.apply_safety_layer",
            new_callable=AsyncMock,
            return_value="raw + DISCLAIMER",
        ) as safety:
            await stage.execute(ctx)
            safety.assert_awaited_once_with("raw")

    @pytest.mark.asyncio
    async def test_no_hit_passes_through(self) -> None:
        cache_service = MagicMock()
        cache_service.check_cache = AsyncMock(return_value=None)
        stage = CacheCheckStage(cache_service=cache_service)
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.query_embedding = [0.1] * 1536

        result = await stage.execute(ctx)
        assert result.cache_hit is False
        assert result.cache_response is None

    @pytest.mark.asyncio
    async def test_skips_when_no_query_embedding(self) -> None:
        cache_service = MagicMock()
        cache_service.check_cache = AsyncMock()
        stage = CacheCheckStage(cache_service=cache_service)
        ctx = ChatContext(request=ChatRequest(query="q"))
        # query_embedding=None

        result = await stage.execute(ctx)
        assert result.cache_hit is False
        cache_service.check_cache.assert_not_awaited()
