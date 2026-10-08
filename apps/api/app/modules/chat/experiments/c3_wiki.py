"""C3 (Meta 전문가 에이전트 식) — 인용 앵커 용어 카드를 근거 앞에 넣는다. 기본 꺼짐.

자주 묻는 핵심 용어는 사람이 검수한 카드(`c3_cards.json`)로, 나머지는 기존 RAG 근거로 답한다.
카드 문장마다 원리강론 원문 인용(앵커)이 붙어 있고 `scripts/experiments/c3_lint_cards.py`가
인용이 원문 그대로인지 검사한다.

규칙
- 질문과 별칭을 모두 공백 제거한 뒤 부분 문자열로 찾는다. 더 긴 별칭이 맞은 카드가 앞선다.
- intent 가 "reasoning" 이면 카드 1장("용어 보조"), 그 밖에는 최대 2장.
- 토큰 중립: 카드를 맨 앞에 넣고 뒤쪽 RAG 근거를 같은 수만큼 뺀다(근거 개수 유지).
  카드 글자 수가 뺀 근거보다 많고 근거가 3개 이상이며 RAG 근거가 2개 이상 남으면 하나를 더 뺀다.
  이때만 개수가 하나 줄어들고, 이 추가 제거로 마지막 RAG 근거를 없애지는 않는다.
- 근거 수보다 많은 카드는 넣지 않는다. 근거가 비어 있으면 카드도 없다(hit=False).
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.modules.chat.experiments import result_key
from app.modules.search.hybrid import SearchResult

CARDS_PATH = Path(__file__).with_name("c3_cards.json")
CARD_SOURCE = "card"
CARD_CHUNK_INDEX = -1
_WHITESPACE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """별칭 비교용 — 공백만 모두 없앤다."""
    return _WHITESPACE.sub("", text)


@lru_cache(maxsize=1)
def load_cards() -> tuple[dict[str, Any], ...]:
    """카드 JSON 을 한 번만 읽는다."""
    with CARDS_PATH.open(encoding="utf-8") as f:
        return tuple(json.load(f))


def match_cards(query: str) -> list[tuple[dict[str, Any], str]]:
    """(카드, 맞은 별칭) 목록. 긴 별칭 우선, 같으면 질문에서 먼저 나온 것."""
    q = normalize(query)
    hits: list[tuple[int, int, dict[str, Any], str]] = []
    for card in load_cards():
        matched = [a for a in card["aliases"] if normalize(a) and normalize(a) in q]
        if not matched:
            continue
        best = max(matched, key=lambda a: len(normalize(a)))
        hits.append((-len(normalize(best)), q.find(normalize(best)), card, best))
    hits.sort(key=lambda h: (h[0], h[1]))
    return [(card, alias) for _, _, card, alias in hits]


def render_card(card: dict[str, Any]) -> str:
    """본문 + 앵커 인용을 생성 프롬프트용 텍스트로."""
    lines = [card["body"], "근거 원문:"]
    for n, anchor in enumerate(card["anchors"], 1):
        volume = anchor["key"].rsplit(":", 1)[0]
        lines.append(f'({n}) {volume} "{anchor["quote"]}"')
    return "\n".join(lines)


def _card_result(card: dict[str, Any]) -> SearchResult:
    return SearchResult(
        text=render_card(card),
        volume=f"용어 카드 · {card['title']}",
        chunk_index=CARD_CHUNK_INDEX,
        score=1.0,
        source=CARD_SOURCE,
    )


def _chars(results: list[SearchResult]) -> int:
    return sum(len(r.text) for r in results)


def apply_cards(
    query: str, intent: str | None, context: list[SearchResult]
) -> tuple[list[SearchResult], list[str], dict[str, Any]]:
    """(새 근거 목록, 근거 키 목록, 기록). 카드 키는 "card:<slug>"."""
    keys = [result_key(r.volume, r.chunk_index) for r in context]
    chars_before = _chars(context)
    hits = match_cards(query)
    cap = 1 if intent == "reasoning" else 2
    chosen = [card for card, _ in hits[: min(cap, len(context))]]
    record: dict[str, Any] = {
        "hit": bool(chosen),
        # 맞은 카드 전부(상한에 걸려 안 넣은 것 포함). 넣은 카드는 "cards".
        "matched_aliases": [alias for _, alias in hits],
        "cards": [],
        "dropped": [],
        "chars_before": chars_before,
        "chars_after": chars_before,
    }
    if not chosen:
        return context, keys, record

    cards = [_card_result(card) for card in chosen]
    keep = len(context) - len(cards)
    rag = list(context[:keep])
    dropped = list(context[keep:])
    if _chars(cards) > _chars(dropped) and len(context) > 2 and len(rag) > 1:
        dropped.insert(0, rag.pop())

    final = cards + rag
    record.update(
        cards=[card["slug"] for card in chosen],
        dropped=[result_key(r.volume, r.chunk_index) for r in dropped],
        chars_after=_chars(final),
    )
    final_keys = [f"card:{card['slug']}" for card in chosen] + [
        result_key(r.volume, r.chunk_index) for r in rag
    ]
    return final, final_keys, record
