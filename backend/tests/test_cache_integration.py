"""Semantic Cache 통합 테스트 — ChatService 캐시 히트/미스 통합."""

import uuid

import pytest
from unittest.mock import AsyncMock, patch

from src.cache.schemas import CacheHit
from src.chat.service import ChatService
from src.chat.schemas import ChatRequest
from src.chat.models import ResearchSession, SessionMessage, MessageRole
from src.safety.output_filter import DISCLAIMER
from src.search.hybrid import SearchResult


def _make_search_results(count: int = 5) -> list[SearchResult]:
    return [
        SearchResult(
            text=f"말씀 {i}", volume=f"vol_{i:03d}", chunk_index=i,
            score=0.9 - i * 0.1, source="A",
        )
        for i in range(count)
    ]


def _make_chat_service(cache_service=None):
    chat_repo = AsyncMock()
    chatbot_service = AsyncMock()

    session = ResearchSession(chatbot_config_id=1, client_fingerprint=None)
    session.id = uuid.uuid4()
    chat_repo.get_session.return_value = None
    chat_repo.create_session.return_value = session

    msg = SessionMessage(session_id=session.id, role=MessageRole.ASSISTANT, content="")
    msg.id = uuid.uuid4()
    chat_repo.create_message.return_value = msg

    chatbot_service.get_config_id.return_value = 1

    return (
        ChatService(chat_repo=chat_repo, chatbot_service=chatbot_service, cache_service=cache_service),
        chat_repo,
        chatbot_service,
    )


class TestCacheHitSkipsSearch:
    """캐시 히트 시 검색/생성 스킵 검증."""

    @pytest.mark.asyncio
    @patch("src.chat.service.embed_dense_query", new_callable=AsyncMock)
    async def test_cache_hit_skips_search(self, mock_embed) -> None:
        mock_embed.return_value = [0.1] * 3072

        cache_service = AsyncMock()
        cache_service.check_cache.return_value = CacheHit(
            question="축복이란?",
            answer="축복은 참부모님으로부터 받는 것입니다.",
            sources=[{"volume": "vol_001", "text": "말씀...", "score": 0.9, "source": "A"}],
            score=0.95,
            created_at=1000000.0,
        )

        service, chat_repo, chatbot_service = _make_chat_service(cache_service)

        request = ChatRequest(query="축복의 의미가 뭐예요?", chatbot_id="test")
        response = await service.process_chat(request)

        # 캐시 히트 → 검색 미호출 (cascading_search/embed_dense_query 등은 mock 으로 차단)
        # 답변에 면책 고지 포함
        assert DISCLAIMER in response.answer
        # 출처 반환
        assert len(response.sources) == 1

    @pytest.mark.asyncio
    @patch("src.chat.service.embed_dense_query", new_callable=AsyncMock)
    @patch("src.chat.pipeline.stages.search.cascading_search", new_callable=AsyncMock)
    @patch("src.chat.pipeline.stages.generation.generate_answer", new_callable=AsyncMock)
    @patch("src.qdrant_client.get_async_client")
    async def test_cache_miss_runs_full_pipeline(
        self, mock_qdrant, mock_generate, mock_search, mock_embed,
    ) -> None:
        mock_embed.return_value = [0.1] * 3072

        cache_service = AsyncMock()
        cache_service.check_cache.return_value = None  # 캐시 미스

        service, _, _ = _make_chat_service(cache_service)
        mock_search.return_value = _make_search_results(5)
        mock_generate.return_value = "전체 파이프라인 답변"

        request = ChatRequest(query="창조원리란?", chatbot_id="test")
        response = await service.process_chat(request)

        # 전체 파이프라인 실행
        mock_search.assert_awaited_once()
        mock_generate.assert_awaited_once()
        # 캐시 저장 호출
        cache_service.store_cache.assert_awaited_once()
        # 면책 고지 포함
        assert DISCLAIMER in response.answer

    @pytest.mark.asyncio
    @patch("src.chat.service.embed_dense_query", new_callable=AsyncMock)
    @patch("src.chat.pipeline.stages.search.cascading_search", new_callable=AsyncMock)
    @patch("src.chat.pipeline.stages.generation.generate_answer", new_callable=AsyncMock)
    @patch("src.qdrant_client.get_async_client")
    async def test_no_cache_service_works(
        self, mock_qdrant, mock_generate, mock_search, mock_embed,
    ) -> None:
        """cache_service=None 이면 캐시 없이 동작."""
        mock_embed.return_value = [0.1] * 3072

        service, _, _ = _make_chat_service(cache_service=None)
        mock_search.return_value = _make_search_results(5)
        mock_generate.return_value = "캐시 없는 답변"

        request = ChatRequest(query="참사랑이란?", chatbot_id="test")
        response = await service.process_chat(request)

        assert DISCLAIMER in response.answer
        mock_search.assert_awaited_once()
