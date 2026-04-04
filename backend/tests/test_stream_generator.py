"""스트리밍 생성기 테스트."""

import pytest
from unittest.mock import AsyncMock, patch

from src.chat.stream_generator import generate_answer_stream
from src.search.hybrid import SearchResult


def _make_results(count: int = 3) -> list[SearchResult]:
    return [
        SearchResult(
            text=f"말씀 텍스트 {i}",
            volume=f"vol_{i:03d}",
            chunk_index=i,
            score=0.9 - i * 0.1,
            source="A",
        )
        for i in range(count)
    ]


class TestGenerateAnswerStream:
    """generate_answer_stream 테스트."""

    @pytest.mark.asyncio
    @patch("src.chat.stream_generator.generate_text_stream")
    async def test_yields_chunks(self, mock_stream: AsyncMock) -> None:
        async def fake_gen(*args, **kwargs):
            yield "참사랑은 "
            yield "자기희생적 "
            yield "사랑입니다."

        mock_stream.return_value = fake_gen()

        results = _make_results()
        collected = []
        async for chunk in generate_answer_stream("참사랑이란?", results):
            collected.append(chunk)

        assert collected == ["참사랑은 ", "자기희생적 ", "사랑입니다."]

    @pytest.mark.asyncio
    @patch("src.chat.stream_generator.generate_text_stream")
    async def test_empty_results_still_works(self, mock_stream: AsyncMock) -> None:
        async def fake_gen(*args, **kwargs):
            yield "관련 말씀을 찾지 못했습니다."

        mock_stream.return_value = fake_gen()

        collected = []
        async for chunk in generate_answer_stream("알 수 없는 질문", []):
            collected.append(chunk)

        assert len(collected) == 1

    @pytest.mark.asyncio
    @patch("src.chat.stream_generator.generate_text_stream")
    async def test_passes_system_prompt(self, mock_stream: AsyncMock) -> None:
        async def fake_gen(*args, **kwargs):
            yield "답변"

        mock_stream.return_value = fake_gen()

        results = _make_results(1)
        async for _ in generate_answer_stream("질문", results):
            pass

        call_kwargs = mock_stream.call_args
        assert "system_instruction" in call_kwargs.kwargs
