"""R2 Vertical Slice — generator 가 동적 system_prompt 를 Gemini 호출에 반영."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.chat.generator import generate_answer
from src.chat.prompt import DEFAULT_SYSTEM_PROMPT
from src.chat.stream_generator import generate_answer_stream
from src.search.hybrid import SearchResult


def _results() -> list[SearchResult]:
    return [SearchResult(text="T1", volume="vol_001", chunk_index=0, score=0.9)]


@pytest.mark.asyncio
async def test_generate_answer_uses_default_prompt_when_none():
    with patch(
        "src.chat.generator.generate_text",
        new_callable=AsyncMock,
        return_value="답변",
    ) as mock:
        await generate_answer("Q", _results(), system_prompt=None)
    _, kwargs = mock.call_args
    assert kwargs["system_instruction"] == DEFAULT_SYSTEM_PROMPT


@pytest.mark.asyncio
async def test_generate_answer_uses_custom_system_prompt():
    custom = "너는 테스트용 assistant다."
    with patch(
        "src.chat.generator.generate_text",
        new_callable=AsyncMock,
        return_value="답변",
    ) as mock:
        await generate_answer("Q", _results(), system_prompt=custom)
    _, kwargs = mock.call_args
    assert kwargs["system_instruction"] == custom


@pytest.mark.asyncio
async def test_generate_answer_empty_string_falls_back_to_default():
    with patch(
        "src.chat.generator.generate_text",
        new_callable=AsyncMock,
        return_value="답변",
    ) as mock:
        await generate_answer("Q", _results(), system_prompt="")
    _, kwargs = mock.call_args
    assert kwargs["system_instruction"] == DEFAULT_SYSTEM_PROMPT


@pytest.mark.asyncio
async def test_generate_answer_stream_uses_custom_system_prompt():
    custom = "스트리밍 커스텀 프롬프트"

    async def fake_stream(*a, **k):
        yield "청크"

    with patch(
        "src.chat.stream_generator.generate_text_stream",
        side_effect=fake_stream,
    ) as mock:
        async for _ in generate_answer_stream("Q", _results(), system_prompt=custom):
            pass
    _, kwargs = mock.call_args
    assert kwargs["system_instruction"] == custom


@pytest.mark.asyncio
async def test_generate_answer_stream_none_falls_back_to_default():
    async def fake_stream(*a, **k):
        yield "청크"

    with patch(
        "src.chat.stream_generator.generate_text_stream",
        side_effect=fake_stream,
    ) as mock:
        async for _ in generate_answer_stream("Q", _results(), system_prompt=None):
            pass
    _, kwargs = mock.call_args
    assert kwargs["system_instruction"] == DEFAULT_SYSTEM_PROMPT
