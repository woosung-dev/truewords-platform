"""C3 용어 카드 — 별칭 매칭·상한·근거 개수 유지·키 형식 (Qdrant·Gemini 없음)."""

from __future__ import annotations

import re

from app.modules.chat.experiments import c3_wiki
from app.modules.search.hybrid import SearchResult


def _ctx(n: int, chars: int = 2000) -> list[SearchResult]:
    return [
        SearchResult(text="가" * chars, volume=f"vol-{i}", chunk_index=i, score=1.0 - i / 100)
        for i in range(n)
    ]


def test_alias_match_ignores_whitespace_on_both_sides() -> None:
    # 별칭 "사위기대" ↔ 질문 "사위 기대", 별칭 "세례요한" ↔ 질문 "세례 요한"
    assert [c["slug"] for c, _ in c3_wiki.match_cards("사위 기대란 무엇인가요?")] == [
        "four-position-foundation"
    ]
    assert [c["slug"] for c, _ in c3_wiki.match_cards("세례 요한은 어떤 사람인가")] == ["elijah-john"]


def test_longer_alias_card_comes_first() -> None:
    hits = c3_wiki.match_cards("십자가에 의한 구원섭리를 설명해 주세요")
    assert [c["slug"] for c, _ in hits] == ["cross-salvation", "salvation-providence"]


def test_reasoning_intent_inserts_one_card() -> None:
    query = "십자가에 의한 구원섭리를 설명해 주세요"
    _, keys, record = c3_wiki.apply_cards(query, "reasoning", _ctx(4))
    assert record["cards"] == ["cross-salvation"]
    assert [k for k in keys if k.startswith("card:")] == ["card:cross-salvation"]

    _, keys, record = c3_wiki.apply_cards(query, "conceptual", _ctx(6))
    assert record["cards"] == ["cross-salvation", "salvation-providence"]


def test_card_count_replaces_trailing_rag_results() -> None:
    context = _ctx(6)  # 근거 하나가 카드보다 길다 → 추가 제거 없음
    new, keys, record = c3_wiki.apply_cards("사위기대와 말세", "conceptual", context)
    assert len(new) == len(context)
    assert keys == ["card:four-position-foundation", "card:last-days"] + [
        f"vol-{i}:{i}" for i in range(4)
    ]
    assert record["dropped"] == ["vol-4:4", "vol-5:5"]
    assert record["chars_after"] <= record["chars_before"]


def test_extra_drop_when_card_longer_than_dropped_passage() -> None:
    new, keys, record = c3_wiki.apply_cards("사위기대란", "factoid", _ctx(4, chars=10))
    assert len(new) == 3  # 카드 1 + RAG 2 (vol-2, vol-3 제거)
    assert keys == ["card:four-position-foundation", "vol-0:0", "vol-1:1"]
    assert record["dropped"] == ["vol-2:2", "vol-3:3"]

    # 근거가 2개 이하면 추가 제거 없이 개수를 유지한다.
    new, keys, _ = c3_wiki.apply_cards("사위기대란", "factoid", _ctx(2, chars=10))
    assert keys == ["card:four-position-foundation", "vol-0:0"]


def test_card_result_shape() -> None:
    new, keys, _ = c3_wiki.apply_cards("수수작용이란", "factoid", _ctx(3))
    card = new[0]
    assert card.volume == "용어 카드 · 만유원력·수수작용·사위기대"
    assert card.chunk_index == -1 and card.source == "card" and card.score == 1.0
    assert "근거 원문:" in card.text and '(1) 원리강론.txt "' in card.text
    assert keys[0] == "card:four-position-foundation"


def test_no_hit_passes_context_through() -> None:
    context = _ctx(4)
    new, keys, record = c3_wiki.apply_cards("하나님의 사랑은 무엇인가", "factoid", context)
    assert new is context
    assert keys == [f"vol-{i}:{i}" for i in range(4)]
    assert record["hit"] is False and record["cards"] == [] and record["dropped"] == []


def test_empty_context_gets_no_card() -> None:
    new, keys, record = c3_wiki.apply_cards("사위기대란", "factoid", [])
    assert new == [] and keys == [] and record["hit"] is False


def test_cards_json_schema() -> None:
    cards = c3_wiki.load_cards()
    assert len(cards) == 20
    assert len({c["slug"] for c in cards}) == 20
    for card in cards:
        assert {"slug", "title", "heading", "aliases", "body", "anchors"} <= card.keys()
        assert 1 <= len(card["aliases"]) <= 6
        assert all(len(c3_wiki.normalize(a)) >= 2 for a in card["aliases"])
        assert card["anchors"]
        for anchor in card["anchors"]:
            assert re.fullmatch(r"원리강론\.txt:\d+", anchor["key"])
            assert anchor["quote"].strip()
        used = {int(n) for n in re.findall(r"\((\d+)\)", card["body"])}
        assert used == set(range(1, len(card["anchors"]) + 1))
