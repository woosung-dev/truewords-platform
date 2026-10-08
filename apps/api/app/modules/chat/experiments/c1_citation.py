"""C1 (Fanar-Sadiq 식) — 구절 조회 + 사후 인용 게이트 + 근거 부족 거절. 기본 꺼짐.

[구현 예정] 지금은 아무것도 바꾸지 않는 자리표시다.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from app.modules.search.hybrid import SearchResult

REFUSAL_ANSWER = "말씀 자료에서 이 질문에 답할 근거를 찾지 못했습니다."


async def passage_lookup(
    query: str, results: list[SearchResult], *, sources: list[str]
) -> tuple[list[SearchResult], dict[str, Any]]:
    """인용구 위치 질문이면 정확 구절을 찾아 맨 앞에 둔다. 아니면 results 를 그대로 돌려준다."""
    return results, {"routed": False}


def should_refuse(results: list[SearchResult], *, reranked: bool) -> tuple[bool, dict[str, Any]]:
    """rerank 최고점이 임계 τ 미만이면 거절. rerank 가 실패했으면 거절하지 않는다."""
    return False, {"refused": False}


async def citation_gate(
    answer: str,
    context: list[SearchResult],
    *,
    regenerate: Callable[[str], Awaitable[str]],
) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
    """답변의 인용구·출처를 근거와 대조한다. (최종 답변, 판정 기록, 시도 목록)."""
    return answer, {"checked": False}, []
