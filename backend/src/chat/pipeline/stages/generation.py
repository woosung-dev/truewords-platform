"""GenerationStage — LLM 답변 생성 (동기). intent 별 컨텍스트 슬라이스 분기."""

from __future__ import annotations

from src.chat.generator import generate_answer
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.search.intent_classifier import generation_context_slice_for


class GenerationStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        slice_n = generation_context_slice_for(ctx.intent)
        context_results = ctx.results[:slice_n]
        ctx.answer = await generate_answer(
            ctx.request.query,
            context_results,
            generation_config=ctx.runtime_config.generation if ctx.runtime_config else None,
        )
        ctx.pipeline_state = PipelineState.GENERATED
        return ctx
