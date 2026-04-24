"""ChatbotRuntimeConfig Pydantic 모델 단위 테스트 (frozen + 기본값)."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
    TierConfig,
)


def _make_config(**overrides) -> ChatbotRuntimeConfig:
    base = dict(
        chatbot_id="cb-test",
        name="테스트",
        search=SearchModeConfig(mode="cascading"),
        generation=GenerationConfig(system_prompt="기본 프롬프트"),
        retrieval=RetrievalConfig(),
        safety=SafetyConfig(),
    )
    base.update(overrides)
    return ChatbotRuntimeConfig(**base)


def test_runtime_config_is_frozen():
    cfg = _make_config()
    with pytest.raises(ValidationError):
        cfg.chatbot_id = "다른값"  # type: ignore[misc]


def test_search_mode_config_defaults():
    smc = SearchModeConfig(mode="cascading")
    assert smc.tiers == []
    assert smc.weights == {}
    assert smc.dictionary_enabled is False


def test_generation_config_persona_optional():
    gen = GenerationConfig(system_prompt="P")
    assert gen.persona_name is None
    assert gen.temperature == 0.7
    assert gen.model_name == "gemini-2.5-flash"


def test_retrieval_config_defaults():
    r = RetrievalConfig()
    assert r.rerank_enabled is True
    assert r.query_rewrite_enabled is True
    assert r.fallback_enabled is True
    assert r.top_k == 10


def test_safety_config_defaults():
    s = SafetyConfig()
    assert s.watermark_enabled is True
    assert s.pii_filter_enabled is True
    assert s.max_query_length == 1000


def test_tier_config_defaults():
    t = TierConfig(sources=["A"])
    assert t.min_results == 3
    assert t.score_threshold == 0.75


def test_runtime_config_validation_rejects_unknown_mode():
    with pytest.raises(ValidationError):
        SearchModeConfig(mode="unknown")  # type: ignore[arg-type]
