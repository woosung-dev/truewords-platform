"""generate_text 의 JSON 모드 — response_schema dict 가 SDK 설정으로 그대로 전달되는지 잠근다."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from google.genai import types

from app.core.common import gemini as gemini_mod
from app.modules.search.reranker import _scores_schema


@pytest.mark.asyncio
async def test_generate_text_sends_json_mode_config(monkeypatch) -> None:
    captured = {}

    class _Client:
        class aio:
            class models:
                @staticmethod
                async def generate_content(**kwargs):
                    captured.update(kwargs)
                    return SimpleNamespace(text='{"scores": [0.5]}', usage_metadata=None)

    monkeypatch.setattr(gemini_mod, "_client", _Client())

    await gemini_mod.generate_text("p", system_instruction="s", response_schema=_scores_schema(3))

    config = captured["config"]
    assert config.system_instruction == "s"
    assert config.response_mime_type == "application/json"
    # SDK 는 요청 직전 dict 를 types.Schema 로 검증·변환한다(_transformers.t_schema). 키 이름이 틀리면 여기서 드러난다.
    scores = types.Schema.model_validate(config.response_schema).properties["scores"]
    assert scores.min_items == 3 and scores.max_items == 3
    assert scores.items.type.value == "NUMBER"


@pytest.mark.asyncio
async def test_generate_text_without_schema_keeps_plain_text(monkeypatch) -> None:
    captured = {}

    class _Client:
        class aio:
            class models:
                @staticmethod
                async def generate_content(**kwargs):
                    captured.update(kwargs)
                    return SimpleNamespace(text="답", usage_metadata=None)

    monkeypatch.setattr(gemini_mod, "_client", _Client())

    assert await gemini_mod.generate_text("p") == "답"
    assert captured["config"].response_mime_type is None
    assert captured["config"].response_schema is None
