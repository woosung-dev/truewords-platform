"""R2 — generator/stream_generator 가 동적 GenerationConfig 의 system_prompt 를 Gemini 호출에 반영."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.chat.generator import generate_answer
from src.chat.prompt import DEFAULT_SYSTEM_PROMPT
from src.chat.stream_generator import generate_answer_stream
from src.chatbot.runtime_config import GenerationConfig
from src.search.hybrid import SearchResult


def _results() -> list[SearchResult]:
    return [SearchResult(text="T1", volume="vol_001", chunk_index=0, score=0.9)]


@pytest.mark.asyncio
async def test_generate_answer_uses_default_when_config_default():
    cfg = GenerationConfig(system_prompt=DEFAULT_SYSTEM_PROMPT)
    with patch(
        "src.chat.generator.generate_text",
        new_callable=AsyncMock,
        return_value="답변",
    ) as mock:
        await generate_answer("Q", _results(), generation_config=cfg)
    _, kwargs = mock.call_args
    assert kwargs["system_instruction"] == DEFAULT_SYSTEM_PROMPT


@pytest.mark.asyncio
async def test_generate_answer_uses_custom_system_prompt():
    custom = "너는 테스트용 assistant다."
    cfg = GenerationConfig(system_prompt=custom)
    with patch(
        "src.chat.generator.generate_text",
        new_callable=AsyncMock,
        return_value="답변",
    ) as mock:
        await generate_answer("Q", _results(), generation_config=cfg)
    _, kwargs = mock.call_args
    assert kwargs["system_instruction"] == custom


@pytest.mark.asyncio
async def test_generation_config_is_immutable():
    """frozen=True 검증: 외부 변경이 generator 에 영향 못 줌."""
    from pydantic import ValidationError

    cfg = GenerationConfig(system_prompt="initial")
    with pytest.raises(ValidationError):
        cfg.system_prompt = "tampered"  # type: ignore[misc]


@pytest.mark.asyncio
async def test_generate_answer_stream_uses_custom_system_prompt():
    custom = "스트리밍 커스텀 프롬프트"
    cfg = GenerationConfig(system_prompt=custom)

    async def fake_stream(*a, **k):
        yield "청크"

    with patch(
        "src.chat.stream_generator.generate_text_stream",
        side_effect=fake_stream,
    ) as mock:
        async for _ in generate_answer_stream("Q", _results(), generation_config=cfg):
            pass
    _, kwargs = mock.call_args
    assert kwargs["system_instruction"] == custom


@pytest.mark.asyncio
async def test_generate_answer_stream_uses_default_prompt():
    cfg = GenerationConfig(system_prompt=DEFAULT_SYSTEM_PROMPT)

    async def fake_stream(*a, **k):
        yield "청크"

    with patch(
        "src.chat.stream_generator.generate_text_stream",
        side_effect=fake_stream,
    ) as mock:
        async for _ in generate_answer_stream("Q", _results(), generation_config=cfg):
            pass
    _, kwargs = mock.call_args
    assert kwargs["system_instruction"] == DEFAULT_SYSTEM_PROMPT
