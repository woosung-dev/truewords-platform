"""generate_answer 비동기 테스트."""

import pytest
from unittest.mock import AsyncMock, patch
from src.chat.prompt import build_context_prompt, DEFAULT_SYSTEM_PROMPT
from src.chat.generator import generate_answer
from src.chatbot.runtime_config import GenerationConfig
from src.search.hybrid import SearchResult


def _make_results():
    return [
        SearchResult(text="하나님은 사랑이시다.", volume="vol_001", chunk_index=0, score=0.95),
        SearchResult(text="참부모님의 가르침은 참사랑이다.", volume="vol_002", chunk_index=1, score=0.88),
    ]


def _gen_cfg(prompt: str = DEFAULT_SYSTEM_PROMPT) -> GenerationConfig:
    return GenerationConfig(system_prompt=prompt)


def test_system_prompt_contains_core_terms():
    assert "참부모님" in DEFAULT_SYSTEM_PROMPT
    assert "말씀" in DEFAULT_SYSTEM_PROMPT
    assert "원리강론" in DEFAULT_SYSTEM_PROMPT


def test_build_context_prompt_includes_all_sources():
    results = _make_results()
    prompt = build_context_prompt("사랑이란 무엇인가?", results)

    assert "하나님은 사랑이시다." in prompt
    assert "참부모님의 가르침은 참사랑이다." in prompt
    assert "vol_001" in prompt
    assert "사랑이란 무엇인가?" in prompt


@pytest.mark.asyncio
async def test_generate_answer_calls_gemini_and_returns_text():
    with patch(
        "src.chat.generator.generate_text",
        new_callable=AsyncMock,
        return_value="사랑은 하나님의 본질입니다.",
    ) as mock_gen:
        answer = await generate_answer(
            "사랑이란?", _make_results(), generation_config=_gen_cfg()
        )

    assert answer == "사랑은 하나님의 본질입니다."
    mock_gen.assert_called_once()
