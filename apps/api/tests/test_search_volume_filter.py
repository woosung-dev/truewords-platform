"""훈독 권리 volume 필터가 채팅 검색 경로 전체(cascading·weighted·fallback)에 Qdrant 쿼리 조건으로 걸리는지.

훈독 AI 질문은 채팅 파이프라인에 위임한다. 필터가 한 단계라도 빠지면 권리가 닫힌 권(예: 말씀선집 615권)의 본문이
답의 근거로 나간다. None(시연 챗)은 기존 검색 그대로여야 한다.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.modules.chat.models import MessageRole, ResearchSession, SessionMessage
from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.pipeline.stages.cache_check import CacheCheckStage
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.service import ChatService
from app.modules.qdrant.raw_client import QdrantPoint
from app.modules.search.cascading import CascadingConfig, SearchTier, cascading_search
from app.modules.search.fallback import fallback_search
from app.modules.search.weighted import WeightedConfig, WeightedSource, weighted_search

OPEN = ["open-1", "open-2"]
VOLUME_CONDITION = {"key": "volume", "match": {"any": OPEN}}


def _client() -> AsyncMock:
    client = AsyncMock()
    client.query_points.return_value = [
        QdrantPoint(id="p", score=0.9, payload={"text": "말씀", "volume": "open-1", "chunk_index": 0, "source": "A"})
    ]
    return client


def _assert_filtered(kwargs: dict) -> None:
    """최종 쿼리와 dense·sparse prefetch 모두에 volume 조건이 있어야 한다(후처리가 아니라 Qdrant 쿼리 시점)."""
    assert VOLUME_CONDITION in kwargs["query_filter"]["must"]
    assert all(VOLUME_CONDITION in p["filter"]["must"] for p in kwargs["prefetch"])


@pytest.fixture
def no_embed():
    with (
        patch("app.modules.search.cascading.embed_sparse_async", AsyncMock(return_value=([1], [1.0]))),
        patch("app.modules.search.weighted.embed_sparse_async", AsyncMock(return_value=([1], [1.0]))),
        patch("app.modules.search.fallback.embed_sparse_async", AsyncMock(return_value=([1], [1.0]))),
    ):
        yield


@pytest.mark.asyncio
async def test_cascading_applies_volume_filter_to_every_tier(no_embed):
    client = _client()
    config = CascadingConfig(tiers=[SearchTier(sources=["A"], min_results=99), SearchTier(sources=["B"])])
    await cascading_search(client, "q", config, dense_embedding=[0.1], volume_filter=OPEN)
    assert client.query_points.call_count == 2
    for call in client.query_points.call_args_list:
        _assert_filtered(call.kwargs)


@pytest.mark.asyncio
async def test_cascading_with_empty_filter_calls_no_qdrant(no_embed):
    client = _client()
    config = CascadingConfig(tiers=[SearchTier(sources=["A"])])
    assert await cascading_search(client, "q", config, dense_embedding=[0.1], volume_filter=[]) == []
    client.query_points.assert_not_called()


@pytest.mark.asyncio
async def test_weighted_applies_volume_filter_to_every_source(no_embed):
    client = _client()
    config = WeightedConfig(sources=[WeightedSource(source="A", weight=1), WeightedSource(source="B", weight=1)])
    await weighted_search(client, "q", config, dense_embedding=[0.1], volume_filter=OPEN)
    assert client.query_points.call_count == 2
    for call in client.query_points.call_args_list:
        _assert_filtered(call.kwargs)


@pytest.mark.asyncio
async def test_fallback_relaxes_source_but_keeps_volume_filter(no_embed):
    client = _client()
    results, kind = await fallback_search(client, "q", [], dense_embedding=[0.1], volume_filter=OPEN)
    assert kind == "relaxed" and results
    kwargs = client.query_points.call_args.kwargs
    assert kwargs["query_filter"] == {"must": [VOLUME_CONDITION]}
    _assert_filtered(kwargs)


@pytest.mark.asyncio
async def test_fallback_with_empty_filter_does_not_search_whole_collection(no_embed):
    client = _client()
    with patch("app.modules.search.fallback.generate_text", AsyncMock()) as llm:
        assert await fallback_search(client, "q", [], dense_embedding=[0.1], volume_filter=[]) == ([], "suggestions")
    client.query_points.assert_not_called()
    llm.assert_not_called()


@pytest.mark.asyncio
async def test_fallback_without_filter_is_unchanged(no_embed):
    client = _client()
    await fallback_search(client, "q", [], dense_embedding=[0.1])
    kwargs = client.query_points.call_args.kwargs
    assert kwargs["query_filter"] is None
    assert all("filter" not in p for p in kwargs["prefetch"])


@pytest.mark.asyncio
async def test_cache_check_skipped_when_volume_filter_set():
    """캐시 답은 필터 없이 만든 답·근거라 돌려주면 필터를 우회한다."""
    cache = AsyncMock()
    ctx = ChatContext(request=ChatRequest(query="q", chatbot_id="all"), volume_filter=OPEN)
    ctx.query_embedding = [0.1]
    await CacheCheckStage(cache).execute(ctx)
    cache.check_cache.assert_not_called()
    assert ctx.cache_hit is False


def _chat_service() -> ChatService:
    chat_repo, chatbot_service = AsyncMock(), AsyncMock()
    session = ResearchSession(chatbot_config_id=1, client_fingerprint=None)
    session.id = uuid.uuid4()
    chat_repo.get_session.return_value = None
    chat_repo.create_session.return_value = session
    msg = SessionMessage(session_id=session.id, role=MessageRole.ASSISTANT, content="")
    msg.id = uuid.uuid4()
    chat_repo.create_message.return_value = msg
    chatbot_service.get_config_id.return_value = 1
    chatbot_service.build_runtime_config.return_value = None
    return ChatService(chat_repo=chat_repo, chatbot_service=chatbot_service)


@pytest.mark.asyncio
@pytest.mark.parametrize("volume_filter", [OPEN, [], None])
@patch("app.modules.chat.pipeline.stages.embedding.embed_dense_query", new_callable=AsyncMock, return_value=[0.1] * 3072)
@patch("app.modules.chat.pipeline.stages.search.fallback_search", new_callable=AsyncMock, return_value=([], "suggestions"))
@patch("app.modules.chat.pipeline.stages.search.cascading_search", new_callable=AsyncMock, return_value=[])
@patch("app.modules.chat.service.generate_answer_stream")
async def test_stream_passes_volume_filter_to_search_and_fallback(
    mock_stream, mock_search, mock_fallback, mock_embed, volume_filter
):
    async def fake_gen(*args, **kwargs):
        yield "답"

    mock_stream.return_value = fake_gen()
    service = _chat_service()
    request = ChatRequest(query="참사랑이란?", chatbot_id="all")
    [e async for e in service.process_chat_stream(request, volume_filter=volume_filter)]
    assert mock_search.call_args.kwargs["volume_filter"] == volume_filter
    assert mock_fallback.call_args.kwargs["volume_filter"] == volume_filter

