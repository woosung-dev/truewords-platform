"""ChatbotService.build_runtime_config 의 weighted 모드 매핑 테스트.

R2 cleanup: 이전엔 ChatbotService._parse_search_config 를 직접 호출했으나,
구 경로 제거 이후 DB JSONB → ChatbotRuntimeConfig.search 매핑은 build_runtime_config
가 단독 책임. weighted_sources 의 score_threshold 보존이 핵심 회귀 차단 포인트.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.chatbot.service import ChatbotService


def _stub_db_config(search_tiers: dict) -> MagicMock:
    cfg = MagicMock()
    cfg.chatbot_id = "cb-test"
    cfg.display_name = "Test"
    cfg.system_prompt = ""
    cfg.persona_name = ""
    cfg.search_tiers = search_tiers
    return cfg


def _make_service(db_config) -> ChatbotService:
    repo = AsyncMock()
    repo.get_by_chatbot_id.return_value = db_config
    return ChatbotService(repo=repo)


@pytest.mark.asyncio
async def test_weighted_mode_maps_score_threshold():
    """search_mode=weighted → SearchModeConfig.weighted_sources 에 score_threshold 까지 보존."""
    cfg = _stub_db_config({
        "search_mode": "weighted",
        "weighted_sources": [
            {"source": "A", "weight": 5, "score_threshold": 0.1},
            {"source": "B", "weight": 3, "score_threshold": 0.08},
        ],
    })
    svc = _make_service(cfg)
    rc = await svc.build_runtime_config("cb-test")
    assert rc is not None
    assert rc.search.mode == "weighted"
    assert len(rc.search.weighted_sources) == 2
    assert rc.search.weighted_sources[0].source == "A"
    assert rc.search.weighted_sources[0].weight == 5
    assert rc.search.weighted_sources[1].score_threshold == 0.08


@pytest.mark.asyncio
async def test_cascading_mode_default():
    """search_mode 미지정 → cascading."""
    cfg = _stub_db_config({
        "tiers": [{"sources": ["A"], "min_results": 3, "score_threshold": 0.1}],
    })
    svc = _make_service(cfg)
    rc = await svc.build_runtime_config("cb-test")
    assert rc is not None
    assert rc.search.mode == "cascading"
    assert len(rc.search.tiers) == 1


@pytest.mark.asyncio
async def test_explicit_cascading_mode():
    """search_mode=cascading 명시."""
    cfg = _stub_db_config({
        "search_mode": "cascading",
        "tiers": [{"sources": ["A", "B"], "min_results": 5, "score_threshold": 0.15}],
    })
    svc = _make_service(cfg)
    rc = await svc.build_runtime_config("cb-test")
    assert rc is not None
    assert rc.search.mode == "cascading"


@pytest.mark.asyncio
async def test_weighted_empty_sources():
    """weighted with empty sources."""
    cfg = _stub_db_config({"search_mode": "weighted", "weighted_sources": []})
    svc = _make_service(cfg)
    rc = await svc.build_runtime_config("cb-test")
    assert rc is not None
    assert rc.search.mode == "weighted"
    assert len(rc.search.weighted_sources) == 0


@pytest.mark.asyncio
async def test_to_search_config_preserves_weighted_score_threshold():
    """build_runtime_config → _to_search_config 통합 흐름이 weighted score_threshold 보존."""
    from src.chat.service import _to_search_config
    from src.search.weighted import WeightedConfig

    cfg = _stub_db_config({
        "search_mode": "weighted",
        "weighted_sources": [
            {"source": "A", "weight": 5, "score_threshold": 0.12},
        ],
    })
    svc = _make_service(cfg)
    rc = await svc.build_runtime_config("cb-test")
    assert rc is not None
    sc = _to_search_config(rc.search)
    assert isinstance(sc, WeightedConfig)
    assert len(sc.sources) == 1
    assert sc.sources[0].score_threshold == 0.12
