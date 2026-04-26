"""PersistStage / cache hit path 의 pipeline_version=2 명시 검증."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.cache.schemas import CacheHit
from src.chat.models import MessageRole, ResearchSession, SessionMessage
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.persist import PersistStage
from src.chat.schemas import ChatRequest
from src.chat.service import ChatService
from src.search.hybrid import SearchResult


def _make_session() -> ResearchSession:
    return ResearchSession(id=uuid.uuid4())


def _make_result() -> SearchResult:
    return SearchResult(
        text="t", volume="1", chunk_index=0, score=0.5, source="A"
    )


class TestPersistStageVersion:
    @pytest.mark.asyncio
    async def test_persist_stage_writes_pipeline_version_2(self) -> None:
        captured: list[SessionMessage] = []

        async def capture_create_message(msg: SessionMessage) -> SessionMessage:
            captured.append(msg)
            msg.id = uuid.uuid4()
            return msg

        chat_repo = MagicMock()
        chat_repo.create_message = AsyncMock(side_effect=capture_create_message)
        chat_repo.create_search_event = AsyncMock()
        chat_repo.create_citations = AsyncMock()
        chat_repo.commit = AsyncMock()

        stage = PersistStage(chat_repo, cache_service=None)
        ctx = ChatContext(request=ChatRequest(query="q"))
        ctx.session = _make_session()
        ctx.answer = "답변"
        ctx.results = [_make_result()]

        await stage.execute(ctx)

        assert len(captured) == 1
        assert captured[0].pipeline_version == 2
        assert captured[0].role == MessageRole.ASSISTANT


class TestCacheHitPathVersion:
    @pytest.mark.asyncio
    async def test_cache_hit_path_writes_pipeline_version_2(self) -> None:
        captured: list[SessionMessage] = []

        async def capture_create_message(msg: SessionMessage) -> SessionMessage:
            captured.append(msg)
            msg.id = uuid.uuid4()
            return msg

        # Repo + chatbot_service mocks
        session_obj = _make_session()
        chat_repo = MagicMock()
        chat_repo.create_message = AsyncMock(side_effect=capture_create_message)
        chat_repo.commit = AsyncMock()
        chat_repo.get_session = AsyncMock(return_value=session_obj)
        chat_repo.create_session = AsyncMock(return_value=session_obj)

        chatbot_service = MagicMock()
        chatbot_service.build_runtime_config = AsyncMock(return_value=None)
        chatbot_service.get_config_id = AsyncMock(return_value=None)

        # Cache service: hit
        cache_service = MagicMock()
        cache_service.check_cache = AsyncMock(
            return_value=CacheHit(
                question="q",
                answer="cached answer",
                sources=[{"volume": "1", "text": "본문", "score": 0.9, "source": "A"}],
                score=0.95,
                created_at=1700000000.0,
            )
        )

        service = ChatService(chat_repo, chatbot_service, cache_service)

        # Patch downstream: session create + embedding + safety
        from unittest.mock import patch

        with (
            patch(
                "src.chat.pipeline.stages.embedding.embed_dense_query",
                new_callable=AsyncMock,
                return_value=[0.1] * 1536,
            ),
            patch(
                "src.chat.pipeline.stages.input_validation.validate_input",
                new_callable=AsyncMock,
            ),
            patch(
                "src.chat.pipeline.stages.cache_check.apply_safety_layer",
                new_callable=AsyncMock,
                return_value="safe answer",
            ),
        ):
            response = await service.process_chat(
                ChatRequest(query="질문", chatbot_id=None)
            )

        assert response.answer == "safe answer"
        assert len(captured) >= 1
        # 마지막 캡처 = assistant cache hit 메시지 (user 메시지가 SessionStage 에서 먼저 저장될 수 있음)
        assistant_msgs = [m for m in captured if m.role == MessageRole.ASSISTANT]
        assert len(assistant_msgs) == 1
        assert assistant_msgs[0].pipeline_version == 2
