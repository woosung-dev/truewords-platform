"""IntentClassifierStage — 사용자 질문을 4 intent 로 분류해 ctx.intent 에 기록.

RuntimeConfigStage 다음, QueryRewriteStage 전에 실행한다. 후속 Rerank/
Generation Stage 는 ctx.intent 를 보고 K 값을 분기한다.

분류 실패/타임아웃/비활성 시 DEFAULT_INTENT (conceptual) 로 fallback.

Phase E — intent==meta 시 short-circuit:
  - ctx.answer 에 표준 fallback 답변 prefill (META_FALLBACK_ANSWER)
  - ctx.results 비움 (검색 미실행)
  - pipeline_state = META_TERMINATED
  service.py 가 이 상태를 보고 Search/Rerank/Generation 을 스킵하고
  SafetyOutputStage + mini-persist 로 바로 진행한다.
"""

from __future__ import annotations

import logging
import os

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.search.intent_classifier import (
    DEFAULT_INTENT,
    META_FALLBACK_ANSWER,
    classify_intent,
)

# 평가/검증용 강제 OFF 토글. 액션 2(system_prompt) 단독 효과 측정 시 사용한다.
# 운영 chatbot-level 토글(retrieval.intent_classifier_enabled)과 분리한 이유:
# - chatbot 별 설정은 admin UI 의 retrieval_config JSON 컬럼에 의존 → DB 갱신 필요
# - 환경변수는 서버 재시작 1번으로 즉시 토글 가능 → A/B 측정 사이클에 적합
_FORCE_OFF_ENV = "INTENT_CLASSIFIER_FORCE_OFF"

logger = logging.getLogger(__name__)


class IntentClassifierStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        force_off = os.getenv(_FORCE_OFF_ENV) == "1"
        # chatbot-level 토글: runtime_config 없거나 enabled=False 시 default 사용.
        enabled = True
        if ctx.runtime_config is not None:
            enabled = getattr(
                ctx.runtime_config.retrieval, "intent_classifier_enabled", True
            )
        if force_off or not enabled:
            ctx.intent = DEFAULT_INTENT
        else:
            ctx.intent = await classify_intent(ctx.request.query, enabled=True)

        if ctx.intent == "meta" and ctx.history:
            # 멀티턴 완화책 — 분류기는 원 질문 단독 입력이라 "그게 무슨 뜻이에요?"
            # 같은 대명사 후속 질문을 meta(범위 밖)로 오분류할 수 있다. 후속 턴은
            # short-circuit 하지 않고 기본 intent 로 강등해 condense → 검색 경로를
            # 태운다 (진짜 범위 밖이면 검색 결과 빈약 시 기존 fallback 이 안전망).
            logger.info(
                "intent_classifier: 후속 턴 meta 판정 → %s 로 강등 (멀티턴 오분류 방어)",
                DEFAULT_INTENT,
            )
            ctx.intent = DEFAULT_INTENT
            ctx.pipeline_state = PipelineState.INTENT_CLASSIFIED
        elif ctx.intent == "meta":
            ctx.answer = META_FALLBACK_ANSWER
            ctx.results = []
            ctx.pipeline_state = PipelineState.META_TERMINATED
        else:
            ctx.pipeline_state = PipelineState.INTENT_CLASSIFIED
        return ctx
