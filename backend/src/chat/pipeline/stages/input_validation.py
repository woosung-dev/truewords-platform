"""InputValidationStage — 입력 검증 (Prompt Injection 방어)."""

from __future__ import annotations

from src.chat.pipeline.context import ChatContext
from src.safety.input_validator import validate_input


class InputValidationStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        await validate_input(ctx.request.query)
        return ctx
