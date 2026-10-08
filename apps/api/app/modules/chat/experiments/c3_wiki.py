"""C3 (Meta 전문가 에이전트 식) — 인용 앵커 용어 카드를 근거 앞에 넣는다. 기본 꺼짐.

[구현 예정] 지금은 근거를 그대로 돌려주는 자리표시다.
"""
from __future__ import annotations

from typing import Any

from app.modules.chat.experiments import result_key
from app.modules.search.hybrid import SearchResult


def apply_cards(
    query: str, intent: str | None, context: list[SearchResult]
) -> tuple[list[SearchResult], list[str], dict[str, Any]]:
    """(새 근거 목록, 근거 키 목록, 기록). 카드 키는 "card:<slug>"."""
    return context, [result_key(r.volume, r.chunk_index) for r in context], {"hit": False}
