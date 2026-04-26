"""InputValidationStage — 입력 검증 (Prompt Injection 방어)."""

from __future__ import annotations

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.safety.input_validator import validate_input


class InputValidationStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        await validate_input(ctx.request.query)
        ctx.pipeline_state = PipelineState.INPUT_VALIDATED
        return ctx
