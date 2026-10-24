"""운영·trace가 함께 사용하는 생성 seam의 결과와 종료 동작."""

import re

import pytest

from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.stream_generator import sanitize_answer_stream
from app.modules.safety import output_filter


@pytest.mark.parametrize(
    "patterns,parts,expected,aborted",
    [
        ([], ["첫 문장.", " 다음 문장."], "첫 문장. 다음 문장.", False),
        (
            [(re.compile("금지구절"), "안전 안내")],
            ["아직 표시하지 않은 금지", "구절", "표시 금지"],
            "안전 안내",
            True,
        ),
    ],
)
async def test_stream_output_and_final_answer(
    patterns, parts, expected, aborted, monkeypatch
):
    monkeypatch.setattr(output_filter, "SENSITIVE_PATTERNS", patterns)
    closed = []

    async def provider():
        try:
            for part in parts:
                yield part
        finally:
            closed.append(True)

    context = ChatContext(request=ChatRequest(query="synthetic"))
    result = [part async for part in sanitize_answer_stream(provider(), context)]
    assert "".join(result) == expected
    assert context.answer == expected
    assert context.stream_sanitizer_aborted is aborted
    assert closed == [True]


async def test_closing_consumer_closes_provider_without_finalizing_answer(monkeypatch):
    monkeypatch.setattr(output_filter, "SENSITIVE_PATTERNS", [])
    closed = []

    async def provider():
        try:
            yield "일부"
            yield "끝"
        finally:
            closed.append(True)

    context = ChatContext(request=ChatRequest(query="synthetic"))
    stream = sanitize_answer_stream(provider(), context)
    assert await anext(stream) == "일부"
    await stream.aclose()
    assert closed == [True]
    assert context.answer is None
