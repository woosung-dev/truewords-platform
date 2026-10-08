"""C2 (Azure agentic retrieval 식) — 질의 분해 → 병렬 검색 → 앱 수준 RRF. 기본 꺼짐.

[구현 예정] 지금은 항상 None(현행 경로 폴백)을 돌려주는 자리표시다.
"""
from __future__ import annotations

from typing import Any

from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.pipeline.stages.search import SearchStage
from app.modules.search.hybrid import SearchResult


async def decomposed_search(
    ctx: ChatContext, search_stage: SearchStage
) -> tuple[list[SearchResult], dict[str, Any]] | None:
    """분해 검색 결과(최대 50)와 기록. None 이면 호출자가 현행 검색을 그대로 쓴다."""
    return None
