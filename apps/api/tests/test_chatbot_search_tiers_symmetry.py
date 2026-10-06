"""search_tiers 저장·표시·런타임 대칭 재현 테스트.

운영 증상: 생성하면 rerank OFF 로 저장되고, 수정 화면에서 저장하면 rerank 키가 사라져
런타임 기본값(ON)으로 바뀐다. 관리자 화면 값 = 저장값 = 런타임 값이어야 한다.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.chatbot.schemas import (
    ChatbotConfigCreate,
    ChatbotConfigResponse,
    ChatbotConfigUpdate,
)
from app.modules.chatbot.service import ChatbotService
from app.core.common.clock import utcnow


def _record(search_tiers: dict) -> SimpleNamespace:
    now = utcnow()
    return SimpleNamespace(
        id=uuid.uuid4(),
        chatbot_id="cb-sym",
        display_name="대칭 확인",
        description="",
        system_prompt="",
        persona_name="",
        search_tiers=search_tiers,
        is_active=True,
        streaming_enabled=True,
        suggested_questions=[],
        suggested_at=None,
        created_at=now,
        updated_at=now,
    )


def _service_with(record: SimpleNamespace) -> tuple[ChatbotService, AsyncMock]:
    repo = AsyncMock()
    repo.get_by_id.return_value = record
    repo.get_by_chatbot_id.return_value = record

    async def _apply(config, updates):
        for key, value in updates.items():
            if value is not None:
                setattr(config, key, value)
        return config

    repo.update.side_effect = _apply
    return ChatbotService(repo=repo), repo


# 관리자 수정 화면이 보내는 search_tiers 와 같은 모양 (rerank_enabled 를 보내지 않던 시절 형태).
_EDIT_PAYLOAD_WITHOUT_RERANK = {
    "search_tiers": {
        "search_mode": "cascading",
        "tiers": [{"sources": ["A"], "min_results": 3, "score_threshold": 0.1}],
        "weighted_sources": [],
        "dictionary_enabled": False,
        "query_rewrite_enabled": False,
        "multiturn_enabled": True,
        "raw_rag_only": False,
    }
}


@pytest.mark.asyncio
async def test_update_keeps_rerank_when_client_does_not_send_it():
    """수정 저장이 보내지 않은 rerank_enabled=False 를 지워 ON 으로 바꾸면 안 된다."""
    record = _record(
        {
            "search_mode": "cascading",
            "tiers": [{"sources": ["A"], "min_results": 3, "score_threshold": 0.1}],
            "rerank_enabled": False,
            "query_rewrite_enabled": False,
        }
    )
    service, _ = _service_with(record)

    before = await service.build_runtime_config("cb-sym")
    await service.update(record.id, ChatbotConfigUpdate.model_validate(_EDIT_PAYLOAD_WITHOUT_RERANK))
    after = await service.build_runtime_config("cb-sym")

    assert before.retrieval.rerank_enabled is False
    assert after.retrieval.rerank_enabled is False
    assert record.search_tiers["rerank_enabled"] is False


@pytest.mark.asyncio
async def test_update_preserves_keys_outside_admin_schema():
    """스키마에 없는 저장 키(theological_stance 등)도 수정 저장 뒤 남는다."""
    record = _record(
        {
            "tiers": [{"sources": ["A"]}],
            "theological_stance": "협회 공식 입장",
        }
    )
    service, _ = _service_with(record)

    await service.update(record.id, ChatbotConfigUpdate.model_validate(_EDIT_PAYLOAD_WITHOUT_RERANK))
    rc = await service.build_runtime_config("cb-sym")

    assert record.search_tiers["theological_stance"] == "협회 공식 입장"
    assert rc.theological_stance == "협회 공식 입장"


@pytest.mark.asyncio
async def test_update_applies_fields_client_sent():
    """보낸 필드는 그대로 반영된다 (tiers 목록은 통째로 교체)."""
    record = _record(
        {
            "tiers": [{"sources": ["A"]}, {"sources": ["B"]}],
            "rerank_enabled": True,
            "query_rewrite_enabled": True,
        }
    )
    service, _ = _service_with(record)

    await service.update(
        record.id,
        ChatbotConfigUpdate.model_validate(
            {"search_tiers": {"tiers": [{"sources": ["C"]}], "rerank_enabled": False}}
        ),
    )
    rc = await service.build_runtime_config("cb-sym")

    assert [t.sources for t in rc.search.tiers] == [["C"]]
    assert rc.retrieval.rerank_enabled is False
    # 보내지 않은 query_rewrite_enabled 는 저장값 유지
    assert rc.retrieval.query_rewrite_enabled is True


@pytest.mark.asyncio
async def test_update_does_not_change_effective_values_for_untouched_legacy_bot():
    """키가 없던 봇(운영 all 봇 rerank 상태)을 화면값 그대로 저장해도 실효값이 같다."""
    record = _record(
        {
            "tiers": [{"sources": ["A"], "min_results": 3, "score_threshold": 0.1}],
            # 운영 all 봇: rerank 키 없음(→ON), rewrite 저장값 False
            "query_rewrite_enabled": False,
        }
    )
    service, _ = _service_with(record)
    before = await service.build_runtime_config("cb-sym")

    # 관리자 화면은 응답값을 받아 그대로 다시 보낸다
    shown = ChatbotConfigResponse.model_validate(record, from_attributes=True)
    await service.update(
        record.id,
        ChatbotConfigUpdate.model_validate({"search_tiers": shown.search_tiers.model_dump()}),
    )
    after = await service.build_runtime_config("cb-sym")

    assert before.retrieval.rerank_enabled is True
    assert before.retrieval.query_rewrite_enabled is False
    assert after.retrieval == before.retrieval
    assert after.search == before.search


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "stored",
    [
        {"tiers": [{"sources": ["A"]}]},
        {"tiers": [{"sources": ["A"]}], "rerank_enabled": False, "query_rewrite_enabled": True},
        {"tiers": [{"sources": ["A"]}], "rerank_enabled": True, "query_rewrite_enabled": False},
    ],
)
async def test_response_shows_runtime_effective_values(stored):
    """관리자 응답에 보이는 값 = 런타임이 쓰는 값 (키가 없는 봇 포함)."""
    record = _record(stored)
    service, _ = _service_with(record)

    shown = ChatbotConfigResponse.model_validate(record, from_attributes=True).search_tiers
    rc = await service.build_runtime_config("cb-sym")

    assert shown.rerank_enabled == rc.retrieval.rerank_enabled
    assert shown.query_rewrite_enabled == rc.retrieval.query_rewrite_enabled
    assert shown.multiturn_enabled == rc.retrieval.multiturn_enabled
    assert shown.raw_rag_only == rc.generation.raw_rag_only
    assert shown.search_mode == rc.search.mode


@pytest.mark.asyncio
async def test_create_default_matches_runtime_default():
    """search_tiers 를 생략한 생성 → 저장값과 런타임 기본값이 같다."""
    repo = AsyncMock()
    repo.get_by_chatbot_id.return_value = None
    created: dict = {}

    async def _create(config):
        created["record"] = config
        return config

    repo.create.side_effect = _create
    service = ChatbotService(repo=repo)
    await service.create(ChatbotConfigCreate(chatbot_id="cb-new", display_name="새 봇"))
    stored = created["record"].search_tiers

    # 같은 봇에서 키만 지운 경우의 런타임 값과 비교 (기본값이 한 곳에서 오는지)
    repo.get_by_chatbot_id.return_value = _record({"tiers": []})
    key_missing = await service.build_runtime_config("cb-sym")

    assert stored["rerank_enabled"] == key_missing.retrieval.rerank_enabled
    assert stored["query_rewrite_enabled"] == key_missing.retrieval.query_rewrite_enabled
    assert stored["multiturn_enabled"] == key_missing.retrieval.multiturn_enabled
    assert stored["raw_rag_only"] == key_missing.generation.raw_rag_only
