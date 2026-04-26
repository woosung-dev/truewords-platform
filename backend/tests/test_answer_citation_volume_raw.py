"""AnswerCitation.volume_raw 채움 검증 (R3 PoC → R1 Phase 2 PersistStage).

PersistStage 가 citations 생성 시 volume_raw (원본 문자열) 과
volume (정수 캐스팅) 을 모두 올바르게 채우는지 검증.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.chat.models import ResearchSession, SessionMessage, MessageRole
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.persist import PersistStage
from src.chat.schemas import ChatRequest
from src.search.hybrid import SearchResult


@pytest.mark.asyncio
async def test_persist_stage_fills_volume_raw_for_string_volume():
    chat_repo = AsyncMock()
    assistant_msg = MagicMock(spec=SessionMessage)
    assistant_msg.id = uuid.uuid4()
    chat_repo.create_message.return_value = assistant_msg

    stage = PersistStage(chat_repo=chat_repo, cache_service=None)

    ctx = ChatContext(request=ChatRequest(query="test"))
    session = MagicMock(spec=ResearchSession)
    session.id = uuid.uuid4()
    ctx.session = session
    ctx.answer = "답변"
    ctx.results = [
        SearchResult(text="t", volume="001권", chunk_index=0, score=0.9, source="A"),
        SearchResult(text="u", volume="123", chunk_index=1, score=0.8, source="B"),
    ]

    await stage.execute(ctx)

    chat_repo.create_citations.assert_awaited_once()
    citations = chat_repo.create_citations.call_args[0][0]
    assert len(citations) == 2
    assert citations[0].volume_raw == "001권"
    assert citations[0].volume == 0
    assert citations[1].volume_raw == "123"
    assert citations[1].volume == 123


@pytest.mark.asyncio
async def test_persist_stage_skips_citations_when_no_results():
    chat_repo = AsyncMock()
    assistant_msg = MagicMock(spec=SessionMessage)
    assistant_msg.id = uuid.uuid4()
    chat_repo.create_message.return_value = assistant_msg

    stage = PersistStage(chat_repo=chat_repo, cache_service=None)

    ctx = ChatContext(request=ChatRequest(query="test"))
    session = MagicMock(spec=ResearchSession)
    session.id = uuid.uuid4()
    ctx.session = session
    ctx.answer = "답변"
    ctx.results = []

    await stage.execute(ctx)

    chat_repo.create_citations.assert_not_awaited()
