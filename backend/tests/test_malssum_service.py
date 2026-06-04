"""malssum 서비스 — 무작위 말씀 선택 단위 테스트 (레드팀 시연)."""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import src.malssum.service as malssum


def test_get_random_malssum_empty_returns_none(monkeypatch):
    monkeypatch.setattr(malssum, "_items", [])
    assert malssum.get_random_malssum() is None


def test_get_random_malssum_returns_item_from_list(monkeypatch):
    items = [
        {"text": "말씀 A", "category": "O", "volume": "1권"},
        {"text": "말씀 B", "category": "B", "volume": "2권"},
    ]
    monkeypatch.setattr(malssum, "_items", items)
    picked = malssum.get_random_malssum()
    # _normalize 가 source 키를 추가하므로 dict 동일성 대신 text 로 검증.
    assert picked is not None
    assert picked["text"] in {i["text"] for i in items}
    assert set(picked.keys()) == {"text", "category", "source", "volume"}


def test_load_filters_blank_text(monkeypatch, tmp_path):
    """text 가 비었거나 공백인 항목은 제외."""
    path = tmp_path / "featured.json"
    path.write_text(
        '[{"text": "유효"}, {"text": "   "}, {"category": "O"}, "bad"]',
        encoding="utf-8",
    )
    monkeypatch.setattr(malssum, "_MALSSUM_PATH", path)
    monkeypatch.setattr(malssum, "_items", None)  # lazy 재로드 강제
    items = malssum._get_items()
    assert len(items) == 1
    assert items[0]["text"] == "유효"


def test_load_missing_file_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(malssum, "_MALSSUM_PATH", tmp_path / "nope.json")
    monkeypatch.setattr(malssum, "_items", None)
    assert malssum._get_items() == []


def test_chat_response_coerces_featured_malssum():
    """ChatResponse.featured_malssum 은 dict → FeaturedMalssum 으로 coerce.

    process_chat 가 get_random_malssum() 의 dict 를 그대로 넘기는 경로를 검증.
    """
    from src.chat.schemas import ChatResponse, FeaturedMalssum

    resp = ChatResponse.model_validate(
        {
            "answer": "답변",
            "sources": [],
            "session_id": str(uuid.uuid4()),
            "message_id": str(uuid.uuid4()),
            "featured_malssum": {"text": "말씀", "category": "O", "volume": "1권"},
        }
    )
    assert isinstance(resp.featured_malssum, FeaturedMalssum)
    assert resp.featured_malssum.text == "말씀"

    none_resp = ChatResponse(
        answer="답변",
        sources=[],
        session_id=uuid.uuid4(),
        message_id=uuid.uuid4(),
    )
    assert none_resp.featured_malssum is None


# ── 주제 매칭 (LLM 분류) ────────────────────────────────────────────────


async def test_pick_for_answer_empty_pool_no_llm(monkeypatch):
    """풀 비면 None — LLM 호출조차 안 함."""
    monkeypatch.setattr(malssum, "_items", [])
    called = AsyncMock()
    monkeypatch.setattr("src.common.gemini.generate_text", called)
    assert await malssum.pick_malssum_for_answer("아무 답변") is None
    called.assert_not_awaited()


async def test_pick_for_answer_matches_classified_theme(monkeypatch):
    """LLM 이 '위로' 분류 → 위로 주제 말씀만 선택."""
    items = [
        {"text": "위로 말씀", "category": "위로", "volume": "1권"},
        {"text": "교리 말씀", "category": "교리", "volume": "2권"},
    ]
    monkeypatch.setattr(malssum, "_items", items)
    monkeypatch.setattr(
        "src.common.gemini.generate_text", AsyncMock(return_value="위로")
    )
    picked = await malssum.pick_malssum_for_answer("마음이 힘들어요")
    assert picked is not None
    assert picked["category"] == "위로"
    assert picked["text"] == "위로 말씀"


async def test_pick_for_answer_unmatched_falls_back_to_whole_pool(monkeypatch):
    """분류 결과가 목록에 없으면(또는 실패) 전체 풀 무작위 fallback."""
    items = [{"text": "유일 말씀", "category": "실천", "volume": "3권"}]
    monkeypatch.setattr(malssum, "_items", items)
    monkeypatch.setattr(
        "src.common.gemini.generate_text", AsyncMock(return_value="존재하지않는주제")
    )
    picked = await malssum.pick_malssum_for_answer("어떻게 실천하나요")
    assert picked is not None
    assert picked["text"] == "유일 말씀"  # 전체 풀에서 fallback


async def test_pick_for_answer_llm_failure_falls_back(monkeypatch):
    """LLM 예외 → 분류 None → 전체 풀 fallback (카드 유지)."""
    items = [{"text": "안전 말씀", "category": "가정", "volume": "4권"}]
    monkeypatch.setattr(malssum, "_items", items)
    monkeypatch.setattr(
        "src.common.gemini.generate_text", AsyncMock(side_effect=RuntimeError("LLM down"))
    )
    picked = await malssum.pick_malssum_for_answer("가정의 화목")
    assert picked is not None
    assert picked["text"] == "안전 말씀"
