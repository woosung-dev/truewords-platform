"""SafetyOutputStage — 면책 고지 + 민감 인명 필터."""

from __future__ import annotations

from src.chat.pipeline.context import ChatContext
from src.safety.output_filter import apply_safety_layer


class SafetyOutputStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        if ctx.answer:
            ctx.answer = await apply_safety_layer(ctx.answer)
        return ctx
