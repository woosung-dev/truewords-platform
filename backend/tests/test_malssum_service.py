"""malssum 서비스 — 무작위 말씀 선택 단위 테스트 (레드팀 시연)."""
from __future__ import annotations

import uuid

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
    assert picked in items


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
