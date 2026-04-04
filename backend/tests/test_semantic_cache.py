"""Semantic Cache 유닛 테스트 — 캐시 히트/미스, TTL, chatbot_id 필터, 저장."""

import time

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.cache.service import SemanticCacheService
from src.cache.schemas import CacheHit


class _FakePoint:
    """Qdrant query_points 결과 포인트 목업."""
    def __init__(self, score: float, payload: dict) -> None:
        self.score = score
        self.payload = payload


class _FakeQueryResult:
    """Qdrant query_points 결과 목업."""
    def __init__(self, points: list[_FakePoint]) -> None:
        self.points = points


class TestCheckCache:
    """캐시 히트/미스 테스트."""

    @pytest.mark.asyncio
    async def test_cache_miss_returns_none(self) -> None:
        client = AsyncMock()
        client.query_points.return_value = _FakeQueryResult(points=[])

        service = SemanticCacheService(client)
        result = await service.check_cache([0.1] * 3072)

        assert result is None

    @pytest.mark.asyncio
    async def test_cache_hit_returns_cache_hit(self) -> None:
        point = _FakePoint(
            score=0.95,
            payload={
                "question": "축복의 의미는?",
                "answer": "축복은 참부모님으로부터 받는 결혼 축복식입니다.",
                "sources": [{"volume": "vol_001", "text": "말씀...", "score": 0.9, "source": "A"}],
                "created_at": time.time(),
            },
        )
        client = AsyncMock()
        client.query_points.return_value = _FakeQueryResult(points=[point])

        service = SemanticCacheService(client)
        result = await service.check_cache([0.1] * 3072)

        assert result is not None
        assert isinstance(result, CacheHit)
        assert result.question == "축복의 의미는?"
        assert result.score == 0.95
        assert len(result.sources) == 1

    @pytest.mark.asyncio
    async def test_cache_check_passes_chatbot_id_filter(self) -> None:
        client = AsyncMock()
        client.query_points.return_value = _FakeQueryResult(points=[])

        service = SemanticCacheService(client)
        await service.check_cache([0.1] * 3072, chatbot_id="chatbot_a")

        call_kwargs = client.query_points.call_args.kwargs
        query_filter = call_kwargs["query_filter"]
        # chatbot_id 필터가 포함되어야 함
        filter_keys = [c.key for c in query_filter.must]
        assert "chatbot_id" in filter_keys

    @pytest.mark.asyncio
    async def test_cache_check_without_chatbot_id(self) -> None:
        client = AsyncMock()
        client.query_points.return_value = _FakeQueryResult(points=[])

        service = SemanticCacheService(client)
        await service.check_cache([0.1] * 3072, chatbot_id=None)

        call_kwargs = client.query_points.call_args.kwargs
        query_filter = call_kwargs["query_filter"]
        # chatbot_id 없으면 created_at 필터만
        filter_keys = [c.key for c in query_filter.must]
        assert "chatbot_id" not in filter_keys
        assert "created_at" in filter_keys


class TestStoreCache:
    """캐시 저장 테스트."""

    @pytest.mark.asyncio
    async def test_store_cache_calls_upsert(self) -> None:
        client = AsyncMock()

        service = SemanticCacheService(client)
        await service.store_cache(
            query="축복의 의미?",
            query_embedding=[0.1] * 3072,
            answer="축복은...",
            sources=[{"volume": "vol_001", "text": "...", "score": 0.9, "source": "A"}],
            chatbot_id="chatbot_a",
        )

        client.upsert.assert_awaited_once()
        call_kwargs = client.upsert.call_args.kwargs
        assert call_kwargs["collection_name"] == "semantic_cache"
        point = call_kwargs["points"][0]
        assert point.payload["question"] == "축복의 의미?"
        assert point.payload["chatbot_id"] == "chatbot_a"
        assert "created_at" in point.payload

    @pytest.mark.asyncio
    async def test_store_cache_without_chatbot_id(self) -> None:
        client = AsyncMock()

        service = SemanticCacheService(client)
        await service.store_cache(
            query="테스트",
            query_embedding=[0.1] * 3072,
            answer="답변",
            sources=[],
        )

        call_kwargs = client.upsert.call_args.kwargs
        point = call_kwargs["points"][0]
        assert point.payload["chatbot_id"] == ""
