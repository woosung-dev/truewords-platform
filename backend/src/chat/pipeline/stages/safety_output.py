"""SafetyOutputStage — 면책 고지 + 민감 인명 필터."""

from __future__ import annotations

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.safety.output_filter import apply_safety_layer


class SafetyOutputStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        if ctx.answer:
            ctx.answer = await apply_safety_layer(ctx.answer)
        ctx.pipeline_state = PipelineState.SAFETY_APPLIED
        return ctx
