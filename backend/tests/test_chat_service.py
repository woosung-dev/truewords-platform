"""ChatService 통합 테스트. 검색 → Re-ranking → 답변 생성 → DB 기록 오케스트레이션."""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.chat.service import ChatService
from src.chat.schemas import ChatRequest
from src.chat.models import ResearchSession, SessionMessage, MessageRole
from src.safety.output_filter import DISCLAIMER
from src.search.hybrid import SearchResult
from src.search.cascading import CascadingConfig, SearchTier
from src.search.exceptions import EmbeddingFailedError

# 모든 테스트에서 embed_dense_query를 mock 처리
pytestmark = pytest.mark.usefixtures()

_EMBED_PATCH = "src.chat.service.embed_dense_query"


def _make_search_results(count: int = 5) -> list[SearchResult]:
    return [
        SearchResult(
            text=f"말씀 {i}",
            volume=f"vol_{i:03d}",
            chunk_index=i,
            score=0.9 - i * 0.1,
            source="A",
        )
        for i in range(count)
    ]


def _make_chat_service() -> tuple[ChatService, AsyncMock, AsyncMock]:
    """ChatService + mock chat_repo + mock chatbot_service 생성."""
    chat_repo = AsyncMock()
    chatbot_service = AsyncMock()

    # 기본 repo 동작
    session = ResearchSession(
        id=uuid.uuid4(),
        chatbot_config_id=None,
    )
    chat_repo.create_session.return_value = session
    chat_repo.get_session.return_value = None

    msg_id = uuid.uuid4()
    user_msg = MagicMock(spec=SessionMessage)
    user_msg.id = msg_id
    assistant_msg = MagicMock(spec=SessionMessage)
    assistant_msg.id = uuid.uuid4()
    chat_repo.create_message.side_effect = [user_msg, assistant_msg]

    chat_repo.commit = AsyncMock()
    chat_repo.create_search_event = AsyncMock()
    chat_repo.create_citations = AsyncMock()

    service = ChatService(chat_repo=chat_repo, chatbot_service=chatbot_service)
    return service, chat_repo, chatbot_service


@pytest.mark.asyncio
async def test_process_chat_without_rerank():
    """Re-ranking 비활성 시 cascading 결과를 그대로 사용."""
    service, chat_repo, chatbot_service = _make_chat_service()
    results = _make_search_results(10)

    cascading_config = CascadingConfig(
        tiers=[SearchTier(sources=["A"], min_results=3, score_threshold=0.5)]
    )
    chatbot_service.get_search_config.return_value = (cascading_config, False, False)
    chatbot_service.get_config_id.return_value = None

    with (
        patch("src.chat.service.get_async_client") as mock_qdrant,
        patch("src.chat.service.cascading_search", new_callable=AsyncMock, return_value=results) as mock_cascade,
        patch("src.chat.service.generate_answer", new_callable=AsyncMock, return_value="답변입니다."),
        patch("src.chat.service.rerank", new_callable=AsyncMock) as mock_rerank,
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        response = await service.process_chat(ChatRequest(query="질문"))

    # rerank가 호출되지 않아야 함
    mock_rerank.assert_not_called()
    assert "답변입니다." in response.answer
    assert DISCLAIMER in response.answer
    assert len(response.sources) == 3
    # 단일 commit 확인
    chat_repo.commit.assert_called_once()


@pytest.mark.asyncio
async def test_process_chat_with_rerank():
    """Re-ranking 활성 시 rerank가 호출되어야 함."""
    service, chat_repo, chatbot_service = _make_chat_service()
    results = _make_search_results(10)
    reranked_results = [
        SearchResult(text=r.text, volume=r.volume, chunk_index=r.chunk_index,
                     score=r.score, source=r.source, rerank_score=0.9 - i * 0.05)
        for i, r in enumerate(results)
    ]

    cascading_config = CascadingConfig(
        tiers=[SearchTier(sources=["A"], min_results=3, score_threshold=0.5)]
    )
    chatbot_service.get_search_config.return_value = (cascading_config, True, False)
    chatbot_service.get_config_id.return_value = None

    with (
        patch("src.chat.service.get_async_client"),
        patch("src.chat.service.cascading_search", new_callable=AsyncMock, return_value=results),
        patch("src.chat.service.generate_answer", new_callable=AsyncMock, return_value="재순위 답변."),
        patch("src.chat.service.rerank", new_callable=AsyncMock, return_value=reranked_results) as mock_rerank,
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        response = await service.process_chat(ChatRequest(query="질문"))

    mock_rerank.assert_called_once()
    assert "재순위 답변." in response.answer


@pytest.mark.asyncio
async def test_process_chat_records_rerank_in_search_event():
    """Re-ranking 활성 시 search_event에 reranked 플래그가 기록되어야 함."""
    service, chat_repo, chatbot_service = _make_chat_service()
    results = _make_search_results(5)
    reranked = [
        SearchResult(text=r.text, volume=r.volume, chunk_index=r.chunk_index,
                     score=r.score, source=r.source, rerank_score=0.8)
        for r in results
    ]

    chatbot_service.get_search_config.return_value = (
        CascadingConfig(tiers=[SearchTier(sources=["A"], min_results=1, score_threshold=0.5)]),
        True, False,
    )
    chatbot_service.get_config_id.return_value = None

    with (
        patch("src.chat.service.get_async_client"),
        patch("src.chat.service.cascading_search", new_callable=AsyncMock, return_value=results),
        patch("src.chat.service.generate_answer", new_callable=AsyncMock, return_value="답변"),
        patch("src.chat.service.rerank", new_callable=AsyncMock, return_value=reranked),
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        await service.process_chat(ChatRequest(query="질문"))

    # search_event 기록 확인
    chat_repo.create_search_event.assert_called_once()
    event = chat_repo.create_search_event.call_args[0][0]
    assert event.applied_filters["reranked"] is True


@pytest.mark.asyncio
async def test_process_chat_single_commit():
    """전체 process_chat이 단일 commit으로 처리되어야 함."""
    service, chat_repo, chatbot_service = _make_chat_service()
    chatbot_service.get_search_config.return_value = (
        CascadingConfig(tiers=[SearchTier(sources=["A"], min_results=1, score_threshold=0.5)]),
        False, False,
    )
    chatbot_service.get_config_id.return_value = None

    with (
        patch("src.chat.service.get_async_client"),
        patch("src.chat.service.cascading_search", new_callable=AsyncMock, return_value=_make_search_results(3)),
        patch("src.chat.service.generate_answer", new_callable=AsyncMock, return_value="답변"),
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        await service.process_chat(ChatRequest(query="질문"))

    # commit이 정확히 1번만 호출
    assert chat_repo.commit.call_count == 1


@pytest.mark.asyncio
async def test_process_chat_empty_results():
    """검색 결과 0건일 때도 정상 응답."""
    service, chat_repo, chatbot_service = _make_chat_service()
    chatbot_service.get_search_config.return_value = (
        CascadingConfig(tiers=[SearchTier(sources=["A"], min_results=1, score_threshold=0.5)]),
        False, False,
    )
    chatbot_service.get_config_id.return_value = None

    with (
        patch("src.chat.service.get_async_client"),
        patch("src.chat.service.cascading_search", new_callable=AsyncMock, return_value=[]),
        patch("src.chat.service.fallback_search", new_callable=AsyncMock, return_value=([], "suggestions")),
        patch("src.chat.service.generate_answer", new_callable=AsyncMock, return_value="해당 내용을 말씀에서 찾지 못했습니다."),
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        response = await service.process_chat(ChatRequest(query="없는 내용"))

    assert "찾지 못했습니다" in response.answer
    assert len(response.sources) == 0


@pytest.mark.asyncio
async def test_process_chat_with_session_id():
    """기존 session_id가 있으면 세션을 재사용."""
    service, chat_repo, chatbot_service = _make_chat_service()
    existing_session = ResearchSession(id=uuid.uuid4(), chatbot_config_id=None)
    chat_repo.get_session.return_value = existing_session

    chatbot_service.get_search_config.return_value = (
        CascadingConfig(tiers=[SearchTier(sources=["A"], min_results=1, score_threshold=0.5)]),
        False, False,
    )

    with (
        patch("src.chat.service.get_async_client"),
        patch("src.chat.service.cascading_search", new_callable=AsyncMock, return_value=_make_search_results(3)),
        patch("src.chat.service.generate_answer", new_callable=AsyncMock, return_value="답변"),
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        response = await service.process_chat(
            ChatRequest(query="질문", session_id=existing_session.id)
        )

    assert response.session_id == existing_session.id
    # 새 세션 생성 안 함
    chat_repo.create_session.assert_not_called()


@pytest.mark.asyncio
async def test_process_chat_context_limited_to_top_5():
    """generate_answer에는 상위 5개 결과만 전달되어야 함."""
    service, chat_repo, chatbot_service = _make_chat_service()
    results = _make_search_results(20)

    chatbot_service.get_search_config.return_value = (
        CascadingConfig(tiers=[SearchTier(sources=["A"], min_results=1, score_threshold=0.5)]),
        False, False,
    )
    chatbot_service.get_config_id.return_value = None

    with (
        patch("src.chat.service.get_async_client"),
        patch("src.chat.service.cascading_search", new_callable=AsyncMock, return_value=results),
        patch("src.chat.service.generate_answer", new_callable=AsyncMock, return_value="답변") as mock_gen,
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        await service.process_chat(ChatRequest(query="질문"))

    # generate_answer에 전달된 결과가 5개인지 확인
    call_args = mock_gen.call_args
    context_results = call_args[0][1]  # 두 번째 positional arg
    assert len(context_results) == 5


@pytest.mark.asyncio
async def test_process_chat_wraps_embedding_failure_as_embedding_failed_error():
    """embed_dense_query 실패가 EmbeddingFailedError로 래핑됨."""
    service, _, chatbot_service = _make_chat_service()

    chatbot_service.get_search_config.return_value = (
        CascadingConfig(tiers=[SearchTier(sources=["A"], min_results=1, score_threshold=0.5)]),
        False, False,
    )
    chatbot_service.get_config_id.return_value = None

    with (
        patch("src.chat.service.get_async_client"),
        patch("src.chat.service.cascading_search", new_callable=AsyncMock),
        patch("src.chat.service.generate_answer", new_callable=AsyncMock),
        patch(_EMBED_PATCH, new_callable=AsyncMock, side_effect=RuntimeError("Gemini API quota exceeded")),
    ):
        with pytest.raises(EmbeddingFailedError) as exc_info:
            await service.process_chat(ChatRequest(query="test query"))

    assert "Gemini API quota exceeded" in str(exc_info.value) or "임베딩 생성 실패" in str(exc_info.value)
