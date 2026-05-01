"""InputValidationStage — 입력 검증 (Prompt Injection 방어).

P1-E 진화 메모: ``validate_input`` 은 인젝션 매치 시 ``InputValidationResult``
(passed=False, reason="injection") 을 반환한다. 본 stage 는 차후 ctx flag 로
변환해 generation/search 스킵 + 표준 거절 응답을 구성할 예정이지만, 현재 PR
에서는 기존 ``InputBlockedError`` 거동을 유지해 호환성을 보존한다.
"""

from __future__ import annotations

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.safety.exceptions import InputBlockedError
from src.safety.input_validator import validate_input


class InputValidationStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        result = await validate_input(ctx.request.query)
        if not result.passed and result.reason == "injection":
            # TODO(P1-E): ctx.injection_detected = True 로 전환 후 generation/search
            # 스킵 + 표준 거절 + 추천 질문 응답으로 변경. 본 PR 은 dataclass 토대만.
            raise InputBlockedError("허용되지 않는 입력 패턴이 감지되었습니다.")
        ctx.pipeline_state = PipelineState.INPUT_VALIDATED
        return ctx
