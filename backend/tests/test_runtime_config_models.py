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
    assert smc.weighted_sources == []
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
    # 0.1 = build_runtime_config 의 fallback default 와 동기화 (RRF 점수대 0.0~0.5 범위)
    # 이전 0.75 는 dead default 였음 (docs/dev-log/2026-05-01-cascade-distribution-measurement.md)
    assert t.score_threshold == 0.1


def test_runtime_config_validation_rejects_unknown_mode():
    with pytest.raises(ValidationError):
        SearchModeConfig(mode="unknown")  # type: ignore[arg-type]


def test_runtime_config_theological_stance_default_none():
    """P1-F: theological_stance 미지정 시 기본값 None."""
    cfg = _make_config()
    assert cfg.theological_stance is None


def test_runtime_config_theological_stance_accepts_text():
    """P1-F: theological_stance 에 임의 문자열 저장 가능."""
    cfg = _make_config(theological_stance="개혁주의 신학에 기반합니다.")
    assert cfg.theological_stance == "개혁주의 신학에 기반합니다."


# --- compose_system_prompt helper (chat/prompt.py, v3 옵션 C) ---

from src.chat.prompt import (  # noqa: E402
    MODE_MODULES,
    compose_system_prompt,
)


def test_compose_substitutes_persona_placeholder():
    result = compose_system_prompt("안녕 {persona}, 질문에 답해.", "standard", "지식이")
    assert "안녕 지식이, 질문에 답해." in result


def test_compose_strips_persona_whitespace():
    result = compose_system_prompt("{persona}!", "standard", "  지식이  ")
    assert "지식이!" in result


def test_compose_none_persona_yields_empty():
    result = compose_system_prompt("나는 {persona}.", "standard", None)
    assert "나는 ." in result


def test_compose_appends_mode_module_for_each_mode():
    """모든 모드에 대해 BASE + 해당 모드 모듈이 합성되어야 한다."""
    base = "공통 본문"
    for mode in ("standard", "theological", "pastoral", "beginner", "kids"):
        result = compose_system_prompt(base, mode, None)
        assert base in result
        # 모드 모듈의 첫 줄(섹션 헤더) 일부가 포함되어야 함
        assert MODE_MODULES[mode].split("\n", 1)[0] in result


def test_compose_unknown_mode_falls_back_to_standard():
    result = compose_system_prompt("기본", "invalid_mode", None)
    assert MODE_MODULES["standard"].split("\n", 1)[0] in result


def test_compose_modes_yield_distinct_outputs():
    """각 모드의 응답 본문이 서로 달라야 한다 (옵션 C 의 강력 적용 보증)."""
    base = "공통 본문"
    outputs = {
        mode: compose_system_prompt(base, mode, None)
        for mode in ("standard", "theological", "pastoral", "beginner", "kids")
    }
    distinct = set(outputs.values())
    assert len(distinct) == 5
