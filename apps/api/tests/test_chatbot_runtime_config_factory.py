"""build_runtime_config — DB ChatbotConfig → ChatbotRuntimeConfig 단위 테스트."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.chatbot.runtime_config import ChatbotRuntimeConfig


def _make_repo(config) -> AsyncMock:
    repo = AsyncMock()
    repo.get_by_chatbot_id.return_value = config
    return repo


def _stub_db_config(**overrides) -> MagicMock:
    cfg = MagicMock()
    cfg.chatbot_id = "cb-test"
    cfg.display_name = "테스트 챗봇"
    cfg.system_prompt = "당신은 {persona} 학습 도우미입니다."
    cfg.persona_name = "지식이"
    cfg.search_tiers = {
        "tiers": [{"sources": ["A"], "min_results": 3, "score_threshold": 0.1}],
        "rerank_enabled": True,
        "query_rewrite_enabled": False,
        "dictionary_enabled": False,
    }
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return cfg


@pytest.mark.asyncio
async def test_build_runtime_config_preserves_persona_placeholder():
    """v3 옵션 C — build_runtime_config 는 더 이상 {persona} 를 치환하지 않는다.

    치환은 GenerationStage 의 compose_system_prompt 가 수행한다. raw base 본문
    + persona_name 을 분리해 저장한다.
    """
    from app.modules.chatbot.service import ChatbotService

    repo = _make_repo(_stub_db_config())
    svc = ChatbotService(repo=repo)
    rc = await svc.build_runtime_config("cb-test")

    assert isinstance(rc, ChatbotRuntimeConfig)
    assert rc.chatbot_id == "cb-test"
    # raw base 본문 그대로 보존 (placeholder 미치환)
    assert rc.generation.system_prompt == "당신은 {persona} 학습 도우미입니다."
    assert rc.generation.persona_name == "지식이"


@pytest.mark.asyncio
async def test_build_runtime_config_uses_default_prompt_when_blank():
    from app.modules.chat.prompt import DEFAULT_SYSTEM_PROMPT
    from app.modules.chatbot.service import ChatbotService

    cfg = _stub_db_config(system_prompt="", persona_name="")
    repo = _make_repo(cfg)
    svc = ChatbotService(repo=repo)
    rc = await svc.build_runtime_config("cb-test")

    assert rc.generation.system_prompt == DEFAULT_SYSTEM_PROMPT
    assert rc.generation.persona_name is None


@pytest.mark.asyncio
async def test_build_runtime_config_search_tiers_propagated():
    from app.modules.chatbot.service import ChatbotService

    repo = _make_repo(_stub_db_config())
    svc = ChatbotService(repo=repo)
    rc = await svc.build_runtime_config("cb-test")

    assert rc.search.mode == "cascading"
    assert len(rc.search.tiers) == 1
    assert rc.search.tiers[0].sources == ["A"]
    assert rc.retrieval.rerank_enabled is True
    assert rc.retrieval.query_rewrite_enabled is False


@pytest.mark.asyncio
async def test_build_runtime_config_returns_none_when_id_none():
    from app.modules.chatbot.service import ChatbotService

    repo = AsyncMock()
    svc = ChatbotService(repo=repo)
    rc = await svc.build_runtime_config(None)

    assert rc is None
    repo.get_by_chatbot_id.assert_not_called()


@pytest.mark.asyncio
async def test_build_runtime_config_raises_when_id_unknown():
    from fastapi import HTTPException
    from app.modules.chatbot.service import ChatbotService

    repo = AsyncMock()
    repo.get_by_chatbot_id.return_value = None
    svc = ChatbotService(repo=repo)
    with pytest.raises(HTTPException):
        await svc.build_runtime_config("missing")


@pytest.mark.asyncio
async def test_build_runtime_config_theological_stance_default_none():
    """P1-F: search_tiers 에 theological_stance 키가 없으면 None."""
    from app.modules.chatbot.service import ChatbotService

    repo = _make_repo(_stub_db_config())
    svc = ChatbotService(repo=repo)
    rc = await svc.build_runtime_config("cb-test")

    assert rc is not None
    assert rc.theological_stance is None


@pytest.mark.asyncio
async def test_build_runtime_config_theological_stance_propagated():
    """P1-F: search_tiers.theological_stance 가 runtime_config 에 전파."""
    from app.modules.chatbot.service import ChatbotService

    cfg = _stub_db_config()
    cfg.search_tiers = {
        **cfg.search_tiers,
        "theological_stance": "초교파 복음주의 신학에 기반합니다.",
    }
    repo = _make_repo(cfg)
    svc = ChatbotService(repo=repo)
    rc = await svc.build_runtime_config("cb-test")

    assert rc is not None
    assert rc.theological_stance == "초교파 복음주의 신학에 기반합니다."


@pytest.mark.asyncio
async def test_build_runtime_config_raw_rag_only_default_false():
    """레드팀 시연 — search_tiers 에 raw_rag_only 키가 없으면 False."""
    from app.modules.chatbot.service import ChatbotService

    repo = _make_repo(_stub_db_config())
    svc = ChatbotService(repo=repo)
    rc = await svc.build_runtime_config("cb-test")

    assert rc is not None
    assert rc.generation.raw_rag_only is False


@pytest.mark.asyncio
async def test_build_runtime_config_raw_rag_only_propagated():
    """레드팀 시연 — search_tiers.raw_rag_only 가 GenerationConfig 로 전파."""
    from app.modules.chatbot.service import ChatbotService

    cfg = _stub_db_config()
    cfg.search_tiers = {**cfg.search_tiers, "raw_rag_only": True}
    repo = _make_repo(cfg)
    svc = ChatbotService(repo=repo)
    rc = await svc.build_runtime_config("cb-test")

    assert rc is not None
    assert rc.generation.raw_rag_only is True


def test_select_system_prompt_raw_rag_only_returns_empty():
    """레드팀 시연 — raw_rag_only=True 면 BASE·모드모듈 우회하고 빈 문자열 반환."""
    from app.modules.chat.pipeline.stages.generation import select_system_prompt
    from app.modules.chatbot.runtime_config import GenerationConfig

    gen_cfg = GenerationConfig(
        system_prompt="당신은 학습 도우미입니다.",
        persona_name="지식이",
        raw_rag_only=True,
    )
    assert select_system_prompt(generation_config=gen_cfg, answer_mode="standard") == ""


def test_select_system_prompt_default_composes_when_not_raw():
    """raw_rag_only=False (기본) 면 기존대로 BASE + 모드모듈 합성."""
    from app.modules.chat.pipeline.stages.generation import select_system_prompt
    from app.modules.chatbot.runtime_config import GenerationConfig

    gen_cfg = GenerationConfig(system_prompt="당신은 학습 도우미입니다.")
    composed = select_system_prompt(generation_config=gen_cfg, answer_mode="standard")
    assert composed != ""
    assert "당신은 학습 도우미입니다." in composed
