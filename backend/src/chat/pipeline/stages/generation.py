"""GenerationStage — LLM 답변 생성 (동기)."""

from __future__ import annotations

from src.chat.generator import generate_answer
from src.chat.pipeline.context import ChatContext


class GenerationStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        context_results = ctx.results[:5]
        ctx.answer = await generate_answer(
            ctx.request.query,
            context_results,
            generation_config=ctx.runtime_config.generation if ctx.runtime_config else None,
        )
        return ctx
