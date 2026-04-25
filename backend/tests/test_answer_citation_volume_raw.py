"""AnswerCitation.volume_raw 채움 검증 (R3 PoC commit 4/4).

Qdrant payload 의 volume 은 문자열 ("001권" 등) 인데 DB 모델은 정수 컬럼이라
강제 캐스팅(int(volume) if volume.isdigit() else 0)이 발생. 원본 문자열을
보존하기 위해 volume_raw 컬럼 추가. 본 테스트는 _record_citations 가 두 컬럼
모두 채우는지 검증.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from src.chat.service import ChatService
from src.search.hybrid import SearchResult


@pytest.mark.asyncio
async def test_record_citations_fills_volume_raw_for_string_volume():
    chat_repo = AsyncMock()
    chatbot_service = AsyncMock()
    service = ChatService(chat_repo=chat_repo, chatbot_service=chatbot_service)

    results = [
        SearchResult(text="t", volume="001권", chunk_index=0, score=0.9, source="A"),
        SearchResult(text="u", volume="123", chunk_index=1, score=0.8, source="B"),
    ]
    msg_id = uuid.uuid4()

    await service._record_citations(msg_id, results)

    chat_repo.create_citations.assert_awaited_once()
    citations = chat_repo.create_citations.call_args[0][0]
    assert len(citations) == 2
    assert citations[0].volume_raw == "001권"
    assert citations[0].volume == 0  # 강제 캐스팅 fallback (isdigit() False)
    assert citations[1].volume_raw == "123"
    assert citations[1].volume == 123  # isdigit() True


@pytest.mark.asyncio
async def test_record_citations_skips_when_no_results():
    chat_repo = AsyncMock()
    service = ChatService(chat_repo=chat_repo, chatbot_service=AsyncMock())
    await service._record_citations(uuid.uuid4(), [])
    chat_repo.create_citations.assert_not_awaited()
