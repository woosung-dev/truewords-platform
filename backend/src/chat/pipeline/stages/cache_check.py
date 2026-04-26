"""CacheCheckStage — Semantic Cache 조회 + 안전 답변 갱신.

Cache hit 시 ctx.cache_hit=True, ctx.cache_response 에 안전 답변 포함된 CacheHit 보유.
service.py 측이 cache_hit 분기로 early return 처리.
"""

from __future__ import annotations

from src.cache.schemas import CacheHit
from src.cache.service import SemanticCacheService
from src.chat.pipeline.context import ChatContext
from src.safety.output_filter import apply_safety_layer


class CacheCheckStage:
    def __init__(self, cache_service: SemanticCacheService | None = None) -> None:
        self.cache_service = cache_service

    async def execute(self, ctx: ChatContext) -> ChatContext:
        if not self.cache_service or ctx.query_embedding is None:
            return ctx

        hit = await self.cache_service.check_cache(
            ctx.query_embedding, ctx.request.chatbot_id
        )
        if hit is None:
            return ctx

        safe_answer = await apply_safety_layer(hit.answer)
        ctx.cache_hit = True
        ctx.cache_response = CacheHit(
            question=hit.question,
            answer=safe_answer,
            sources=hit.sources,
            score=hit.score,
            created_at=hit.created_at,
        )
        return ctx
