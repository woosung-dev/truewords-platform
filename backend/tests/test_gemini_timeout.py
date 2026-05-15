"""audit 2차 S-4 (2026-05-15) — Gemini hard timeout 회귀 잠금.

기존 retry_429=True 만으로는 SDK 기본 동작에 의존 → 동시 요청 시 Gemini 무한 대기로
Cloud Run concurrency 잠김 + 비용 폭증 (메타 β single biggest production risk).
``common.gemini.generate_text`` / ``generate_text_stream`` 에 ``asyncio.timeout``
context manager 로 application-level cutoff 적용. 본 test 는 timeout 트리거 시
TimeoutError 가 caller 로 전파되는지 잠금.
"""

from __future__ import annotations

import asyncio

import pytest

from src.common import gemini as gemini_mod


@pytest.mark.asyncio
async def test_generate_text_raises_on_timeout(monkeypatch) -> None:
    """generate_text 가 `gemini_generate_timeout_seconds` 초과 시 TimeoutError."""

    class _FrozenClient:
        class aio:
            class models:
                @staticmethod
                async def generate_content(**_kwargs):
                    # 영원히 대기 → asyncio.timeout 트리거 강제
                    await asyncio.sleep(10)
                    return None

    monkeypatch.setattr(gemini_mod, "_client", _FrozenClient())
    monkeypatch.setattr(gemini_mod.settings, "gemini_generate_timeout_seconds", 0.1)

    with pytest.raises(TimeoutError):
        await gemini_mod.generate_text("hello")


@pytest.mark.asyncio
async def test_generate_text_stream_raises_on_timeout(monkeypatch) -> None:
    """generate_text_stream 도 전체 stream lifetime cutoff."""

    class _FrozenStream:
        def __aiter__(self):
            return self

        async def __anext__(self):
            await asyncio.sleep(10)
            raise StopAsyncIteration

    class _FrozenClient:
        class aio:
            class models:
                @staticmethod
                async def generate_content_stream(**_kwargs):
                    return _FrozenStream()

    monkeypatch.setattr(gemini_mod, "_client", _FrozenClient())
    monkeypatch.setattr(gemini_mod.settings, "gemini_stream_timeout_seconds", 0.1)

    with pytest.raises(TimeoutError):
        async for _chunk in gemini_mod.generate_text_stream("hello"):
            pass


@pytest.mark.asyncio
async def test_generate_text_succeeds_within_timeout(monkeypatch) -> None:
    """timeout 안에 응답하면 정상 반환."""

    class _Response:
        text = "ok"

    class _FastClient:
        class aio:
            class models:
                @staticmethod
                async def generate_content(**_kwargs):
                    return _Response()

    monkeypatch.setattr(gemini_mod, "_client", _FastClient())
    monkeypatch.setattr(gemini_mod.settings, "gemini_generate_timeout_seconds", 5.0)

    result = await gemini_mod.generate_text("hello")
    assert result == "ok"
