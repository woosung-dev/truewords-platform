"""4 intent × (rerank top_k, generation context slice) 분기 + meta short-circuit 통합 검증.

- factoid/conceptual/reasoning: 본 chain 통과, intent 별 K 분기.
- meta: Phase E short-circuit. Search/Rerank/Generation 미실행, META_FALLBACK_ANSWER prefill.

매핑 (src/search/intent_classifier.py):
    factoid    → rerank_top_k=15, gen_ctx_slice=8
    conceptual → rerank_top_k=12, gen_ctx_slice=6
    reasoning  → rerank_top_k=8,  gen_ctx_slice=4
    meta       → short-circuit (mini-persist + META_FALLBACK_ANSWER)
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.chat.models import ResearchSession, SessionMessage
from src.chat.schemas import ChatRequest
from src.chat.service import ChatService
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
    TierConfig,
)
from src.search.hybrid import SearchResult


_EMBED_PATCH = "src.chat.pipeline.stages.embedding.embed_dense_query"


def _make_results(n: int) -> list[SearchResult]:
    return [
        SearchResult(
            text=f"말씀 {i}",
            volume=f"vol_{i:03d}",
            chunk_index=i,
            score=0.9 - i * 0.01,
            source="A",
        )
        for i in range(n)
    ]


def _runtime_config_with_rerank() -> ChatbotRuntimeConfig:
    return ChatbotRuntimeConfig(
        chatbot_id="t",
        name="t",
        search=SearchModeConfig(
            mode="cascading",
            tiers=[TierConfig(sources=["A"], min_results=3, score_threshold=0.0)],
        ),
        generation=GenerationConfig(system_prompt="sp"),
        retrieval=RetrievalConfig(rerank_enabled=True, query_rewrite_enabled=False),
        safety=SafetyConfig(),
    )


def _make_service() -> tuple[ChatService, AsyncMock]:
    chat_repo = AsyncMock()
    chatbot_service = AsyncMock()
    chatbot_service.build_runtime_config.return_value = _runtime_config_with_rerank()

    session = ResearchSession(id=uuid.uuid4(), chatbot_config_id=None)
    chat_repo.create_session.return_value = session
    chat_repo.get_session.return_value = None

    user_msg = MagicMock(spec=SessionMessage)
    user_msg.id = uuid.uuid4()
    assistant_msg = MagicMock(spec=SessionMessage)
    assistant_msg.id = uuid.uuid4()
    chat_repo.create_message.side_effect = [user_msg, assistant_msg]
    chat_repo.commit = AsyncMock()
    chat_repo.create_search_event = AsyncMock()
    chat_repo.create_citations = AsyncMock()

    service = ChatService(chat_repo=chat_repo, chatbot_service=chatbot_service)
    return service, chat_repo


@pytest.mark.parametrize(
    "intent,expected_rerank_top_k,expected_gen_slice",
    [
        ("factoid", 15, 8),
        ("conceptual", 12, 6),
        ("reasoning", 8, 4),
    ],
)
@pytest.mark.asyncio
async def test_intent_drives_rerank_and_generation_K(
    intent: str,
    expected_rerank_top_k: int,
    expected_gen_slice: int,
) -> None:
    service, _ = _make_service()
    # 검색 결과 20건 → rerank 후 K건 → generation 슬라이스
    search_results = _make_results(20)
    reranked_results = _make_results(expected_rerank_top_k)

    with (
        patch("src.qdrant_client.get_async_client"),
        patch(
            "src.chat.pipeline.stages.intent_classifier.classify_intent",
            new_callable=AsyncMock,
            return_value=intent,
        ),
        patch(
            "src.chat.pipeline.stages.search.cascading_search",
            new_callable=AsyncMock,
            return_value=search_results,
        ),
        patch(
            "src.chat.pipeline.stages.rerank.rerank",
            new_callable=AsyncMock,
            return_value=reranked_results,
        ) as mock_rerank,
        patch(
            "src.chat.pipeline.stages.generation.generate_answer",
            new_callable=AsyncMock,
            return_value="답변",
        ) as mock_gen,
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        await service.process_chat(ChatRequest(query="질문", chatbot_id="t"))

    # rerank() 가 intent 에 맞는 top_k 로 호출되었는가
    assert mock_rerank.await_count == 1
    rerank_kwargs = mock_rerank.await_args.kwargs
    assert rerank_kwargs["top_k"] == expected_rerank_top_k, (
        f"intent={intent}: expected rerank top_k={expected_rerank_top_k}, got {rerank_kwargs['top_k']}"
    )

    # generate_answer 에 전달된 컨텍스트 길이 확인
    assert mock_gen.await_count == 1
    context_results = mock_gen.await_args.args[1]
    assert len(context_results) == expected_gen_slice, (
        f"intent={intent}: expected gen slice={expected_gen_slice}, got {len(context_results)}"
    )


@pytest.mark.asyncio
async def test_meta_intent_short_circuits_pipeline() -> None:
    """Phase E: meta intent 시 Search/Rerank/Generation 호출 없이 META_FALLBACK_ANSWER 반환."""
    from src.search.intent_classifier import META_FALLBACK_ANSWER

    service, _ = _make_service()

    with (
        patch("src.qdrant_client.get_async_client"),
        patch(
            "src.chat.pipeline.stages.intent_classifier.classify_intent",
            new_callable=AsyncMock,
            return_value="meta",
        ),
        patch(
            "src.chat.pipeline.stages.search.cascading_search",
            new_callable=AsyncMock,
        ) as mock_search,
        patch(
            "src.chat.pipeline.stages.rerank.rerank",
            new_callable=AsyncMock,
        ) as mock_rerank,
        patch(
            "src.chat.pipeline.stages.generation.generate_answer",
            new_callable=AsyncMock,
        ) as mock_gen,
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        response = await service.process_chat(ChatRequest(query="너는 누구야?", chatbot_id="t"))

    # Search/Rerank/Generation 미호출
    mock_search.assert_not_called()
    mock_rerank.assert_not_called()
    mock_gen.assert_not_called()

    # 답변에 META_FALLBACK_ANSWER 포함 (SafetyOutput가 면책고지를 추가했을 수 있음)
    assert META_FALLBACK_ANSWER in response.answer
    # sources 없음
    assert response.sources == []


@pytest.mark.asyncio
async def test_disabled_intent_classifier_uses_default_K() -> None:
    """retrieval.intent_classifier_enabled=False 시 LLM 호출 없이 conceptual default → [:6]."""
    chat_repo = AsyncMock()
    chatbot_service = AsyncMock()
    config = ChatbotRuntimeConfig(
        chatbot_id="t",
        name="t",
        search=SearchModeConfig(
            mode="cascading",
            tiers=[TierConfig(sources=["A"], min_results=3, score_threshold=0.0)],
        ),
        generation=GenerationConfig(system_prompt="sp"),
        retrieval=RetrievalConfig(
            rerank_enabled=True,
            query_rewrite_enabled=False,
            intent_classifier_enabled=False,
        ),
        safety=SafetyConfig(),
    )
    chatbot_service.build_runtime_config.return_value = config
    session = ResearchSession(id=uuid.uuid4(), chatbot_config_id=None)
    chat_repo.create_session.return_value = session
    chat_repo.get_session.return_value = None
    user_msg = MagicMock(spec=SessionMessage)
    user_msg.id = uuid.uuid4()
    assistant_msg = MagicMock(spec=SessionMessage)
    assistant_msg.id = uuid.uuid4()
    chat_repo.create_message.side_effect = [user_msg, assistant_msg]
    chat_repo.commit = AsyncMock()
    chat_repo.create_search_event = AsyncMock()
    chat_repo.create_citations = AsyncMock()
    service = ChatService(chat_repo=chat_repo, chatbot_service=chatbot_service)

    with (
        patch("src.qdrant_client.get_async_client"),
        patch(
            "src.chat.pipeline.stages.intent_classifier.classify_intent",
            new_callable=AsyncMock,
        ) as mock_classify,
        patch(
            "src.chat.pipeline.stages.search.cascading_search",
            new_callable=AsyncMock,
            return_value=_make_results(20),
        ),
        patch(
            "src.chat.pipeline.stages.rerank.rerank",
            new_callable=AsyncMock,
            return_value=_make_results(12),
        ),
        patch(
            "src.chat.pipeline.stages.generation.generate_answer",
            new_callable=AsyncMock,
            return_value="답변",
        ) as mock_gen,
        patch(_EMBED_PATCH, new_callable=AsyncMock, return_value=[0.1] * 3072),
    ):
        await service.process_chat(ChatRequest(query="질문", chatbot_id="t"))

    # LLM 호출 안 되었는가
    mock_classify.assert_not_awaited()
    # conceptual default → [:6]
    context_results = mock_gen.await_args.args[1]
    assert len(context_results) == 6
