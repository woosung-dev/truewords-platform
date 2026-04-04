"""Gemini 스트리밍 클라이언트 테스트."""

import pytest
from unittest.mock import patch, MagicMock

from src.common.gemini import generate_text_stream


class _FakeChunk:
    """Gemini 스트리밍 청크 목업."""
    def __init__(self, text: str | None) -> None:
        self.text = text


class _FakeAsyncIter:
    """비동기 이터레이터 — generate_content_stream 반환값 목업."""
    def __init__(self, chunks: list[_FakeChunk]) -> None:
        self._chunks = chunks
        self._idx = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._idx >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._idx]
        self._idx += 1
        return chunk


class TestGenerateTextStream:
    """generate_text_stream 비동기 제너레이터 테스트."""

    @pytest.mark.asyncio
    @patch("src.common.gemini._client")
    async def test_yields_text_chunks(self, mock_client: MagicMock) -> None:
        chunks = [_FakeChunk("안녕"), _FakeChunk("하세요"), _FakeChunk("!")]
        mock_client.aio.models.generate_content_stream.return_value = _FakeAsyncIter(chunks)

        collected = []
        async for text in generate_text_stream("테스트 프롬프트"):
            collected.append(text)

        assert collected == ["안녕", "하세요", "!"]

    @pytest.mark.asyncio
    @patch("src.common.gemini._client")
    async def test_skips_none_text_chunks(self, mock_client: MagicMock) -> None:
        chunks = [_FakeChunk("참사랑"), _FakeChunk(None), _FakeChunk("입니다")]
        mock_client.aio.models.generate_content_stream.return_value = _FakeAsyncIter(chunks)

        collected = []
        async for text in generate_text_stream("테스트"):
            collected.append(text)

        assert collected == ["참사랑", "입니다"]

    @pytest.mark.asyncio
    @patch("src.common.gemini._client")
    async def test_empty_stream(self, mock_client: MagicMock) -> None:
        mock_client.aio.models.generate_content_stream.return_value = _FakeAsyncIter([])

        collected = []
        async for text in generate_text_stream("빈 응답"):
            collected.append(text)

        assert collected == []

    @pytest.mark.asyncio
    @patch("src.common.gemini._client")
    async def test_passes_system_instruction(self, mock_client: MagicMock) -> None:
        mock_client.aio.models.generate_content_stream.return_value = _FakeAsyncIter(
            [_FakeChunk("응답")]
        )

        collected = []
        async for text in generate_text_stream("질문", system_instruction="시스템 지시"):
            collected.append(text)

        assert collected == ["응답"]
        call_kwargs = mock_client.aio.models.generate_content_stream.call_args
        assert call_kwargs.kwargs["config"].system_instruction == "시스템 지시"
