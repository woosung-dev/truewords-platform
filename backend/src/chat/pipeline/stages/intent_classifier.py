"""IntentClassifierStage — 사용자 질문을 4 intent 로 분류해 ctx.intent 에 기록.

RuntimeConfigStage 다음, QueryRewriteStage 전에 실행한다. 후속 Rerank/
Generation Stage 는 ctx.intent 를 보고 K 값을 분기한다.

분류 실패/타임아웃/비활성 시 DEFAULT_INTENT (conceptual) 로 fallback.
"""

from __future__ import annotations

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.search.intent_classifier import DEFAULT_INTENT, classify_intent


class IntentClassifierStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        # chatbot-level 토글: runtime_config 없거나 enabled=False 시 default 사용.
        enabled = True
        if ctx.runtime_config is not None:
            enabled = getattr(
                ctx.runtime_config.retrieval, "intent_classifier_enabled", True
            )
        if not enabled:
            ctx.intent = DEFAULT_INTENT
        else:
            ctx.intent = await classify_intent(ctx.request.query, enabled=True)
        ctx.pipeline_state = PipelineState.INTENT_CLASSIFIED
        return ctx
