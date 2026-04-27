"""PipelineState — Stage 전이 상태 + 사전조건 매핑 (R1 Phase 3 N3 FSM).

1차 구현은 **로깅 전용** — 사전조건 미충족 시 logger.warning 만 발생.
강제 차단 (raise) 은 점진 강화 단계에서 도입.

force_transition_to: stream 비정상 종료 (CancelledError, GeneratorExit) 처럼
정상 FSM 흐름 밖의 이벤트를 기록하기 위한 helper.
"""

from __future__ import annotations

import enum
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.chat.pipeline.context import ChatContext

logger = logging.getLogger(__name__)


class PipelineState(str, enum.Enum):
    INIT = "INIT"
    INPUT_VALIDATED = "INPUT_VALIDATED"
    SESSION_READY = "SESSION_READY"
    EMBEDDED = "EMBEDDED"
    CACHE_CHECKED = "CACHE_CHECKED"
    CACHE_HIT_TERMINATED = "CACHE_HIT_TERMINATED"
    RUNTIME_RESOLVED = "RUNTIME_RESOLVED"
    INTENT_CLASSIFIED = "INTENT_CLASSIFIED"
    QUERY_REWRITTEN = "QUERY_REWRITTEN"
    SEARCHED = "SEARCHED"
    RERANKED = "RERANKED"
    GENERATED = "GENERATED"
    SAFETY_APPLIED = "SAFETY_APPLIED"
    PERSISTED = "PERSISTED"
    STREAM_ABORTED = "STREAM_ABORTED"


# 각 Stage 가 진입 시 허용되는 사전 상태 set.
# 미충족 시 logger.warning 발생 (강제 차단 X).
EXPECTED_PRIOR: dict[str, set[PipelineState]] = {
    "InputValidationStage": {PipelineState.INIT},
    "SessionStage": {PipelineState.INPUT_VALIDATED},
    "EmbeddingStage": {PipelineState.SESSION_READY},
    "CacheCheckStage": {PipelineState.EMBEDDED},
    "RuntimeConfigStage": {PipelineState.CACHE_CHECKED},
    "IntentClassifierStage": {PipelineState.RUNTIME_RESOLVED},
    "QueryRewriteStage": {PipelineState.INTENT_CLASSIFIED},
    "SearchStage": {PipelineState.QUERY_REWRITTEN},
    "RerankStage": {PipelineState.SEARCHED},
    "GenerationStage": {PipelineState.RERANKED},
    "SafetyOutputStage": {PipelineState.GENERATED},
    "PersistStage": {PipelineState.SAFETY_APPLIED},
}


def check_precondition(stage_name: str, ctx: ChatContext) -> bool:
    """사전조건 검증. 미충족 시 logger.warning + False 반환.

    CACHE_HIT_TERMINATED 상태는 silent skip (정상 종료 후 잔여 stage 가 호출되어도
    경고 없이 통과). 강제 차단은 하지 않으므로 호출자가 반환값을 보고 처리.
    """
    if ctx.pipeline_state == PipelineState.CACHE_HIT_TERMINATED:
        return True  # silent — 정상 종료 후 호출은 false-positive 가 아님
    expected = EXPECTED_PRIOR.get(stage_name)
    if expected is None or ctx.pipeline_state in expected:
        return True
    logger.warning(
        "stage=%s precondition failed: state=%s expected=%s",
        stage_name,
        ctx.pipeline_state.value,
        sorted(s.value for s in expected),
    )
    return False


def force_transition_to(
    ctx: ChatContext, new_state: PipelineState, *, reason: str
) -> None:
    """FSM 검증을 우회한 강제 전이. logger.warning 으로 기록.

    스트림 client disconnect / cancellation 처럼 정상 흐름 밖 이벤트 전용.
    """
    logger.warning(
        "fsm_forced_transition from=%s to=%s reason=%s",
        ctx.pipeline_state.value,
        new_state.value,
        reason,
    )
    ctx.pipeline_state = new_state
