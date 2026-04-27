"""Intent Classifier — 사용자 쿼리를 4가지 의도로 분류한다.

질문 유형별로 검색/리랭킹/생성 단계의 K 값을 분기하기 위해 사용한다.
LLM 호출이 실패/타임아웃 시 graceful degradation 으로 conceptual 을
반환한다 — 기존 단일 K 동작과 가장 가까운 안전한 default.

분류 기준:
- factoid    : 단순 사실 조회 / 직접 출처 인용 (정답이 짧고 명확)
- conceptual : 개념 정의 / 주제 요약 / 단일 개념 설명
- reasoning  : 추론 / 해석 / 비교 / 적용 / 신학적 의미 도출
- meta       : 가정연합 말씀 범위 밖의 질문 (자기소개, 일반 인사 등)

분류 후속 K 매핑은 RerankStage / GenerationStage / service 가 담당.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal, get_args

from src.common.gemini import MODEL_GENERATE, generate_text

logger = logging.getLogger(__name__)

Intent = Literal["factoid", "conceptual", "reasoning", "meta"]

# 4 라벨 set + default fallback
INTENT_LABELS: tuple[Intent, ...] = get_args(Intent)
DEFAULT_INTENT: Intent = "conceptual"

# Phase D — intent 별 K 값 분기 매핑.
# 추론(reasoning)은 컨텍스트 노이즈에 약 2배 민감 (Dhara&Sheth 2026, Cuconasu SIGIR 2024)
# → 더 적은 컨텍스트로 noise 차단. 사실(factoid)은 다양한 출처를 폭넓게 인용 가능.
# meta 는 Phase D 에서 conceptual fallback, Phase E 에서 short-circuit 도입.
INTENT_RERANK_TOP_K: dict[Intent, int] = {
    "factoid": 15,
    "conceptual": 12,
    "reasoning": 8,
    "meta": 12,
}
INTENT_GEN_CONTEXT_SLICE: dict[Intent, int] = {
    "factoid": 8,
    "conceptual": 6,
    "reasoning": 4,
    "meta": 6,
}

# ctx.intent 가 None 일 때 (legacy 경로) 사용할 fallback K.
# 직전 보존 커밋의 튜닝값과 동일 — rerank=15, gen ctx=8.
LEGACY_RERANK_TOP_K = 15
LEGACY_GEN_CONTEXT_SLICE = 8

# Phase E — meta intent 시 사용할 표준 답변. 보안 가드레일 §4 답변 범위 제한 정신.
# admin UI 의 system_prompt 와 별개로, 코드 레벨 안전망 (LLM 호출 비용/오답 위험 회피).
META_FALLBACK_ANSWER = (
    "해당 질문은 가정연합 말씀 학습 도우미의 답변 범위를 벗어납니다. "
    "말씀이나 원리에 관한 질문을 해 주시면 도와드리겠습니다."
)


def rerank_top_k_for(intent: Intent | None) -> int:
    """ctx.intent → rerank top_k. None 이면 legacy 값."""
    if intent is None:
        return LEGACY_RERANK_TOP_K
    return INTENT_RERANK_TOP_K[intent]


def generation_context_slice_for(intent: Intent | None) -> int:
    """ctx.intent → generation 컨텍스트 슬라이스 길이. None 이면 legacy 값."""
    if intent is None:
        return LEGACY_GEN_CONTEXT_SLICE
    return INTENT_GEN_CONTEXT_SLICE[intent]

# LLM 호출 타임아웃 — 검색 지연 최소화. query_rewriter (1.5s) 보다 짧게 잡는다.
INTENT_TIMEOUT_SECONDS = 0.8

INTENT_CLASSIFIER_SYSTEM_PROMPT = """당신은 가정연합 말씀 RAG 검색 시스템의 질문 분류기입니다.
사용자 질문을 아래 4가지 의도(intent) 중 정확히 하나로 분류하세요.

[분류 기준]
- factoid: 단순 사실 조회 또는 직접 출처 인용. 정답이 짧고 명확.
  예) "한학자 총재의 출생지는 어디입니까?"
  예) "원리강론 어디에 나옵니까?"
  예) "참부모님은 누구입니까?"

- conceptual: 개념 정의, 주제 요약, 단일 개념 설명. 사실보다 약간의 정리/요약.
  예) "축복의 의미를 설명해 주세요."
  예) "천일국 개념을 알려주세요."
  예) "효정이란 무엇입니까?"

- reasoning: 추론, 해석, 비교, 적용, 신학적 의미 도출. 검색된 자료 위에서 사고가 필요한 질문.
  예) "참부모님과 동시대에 산다는 것이 어떤 신학적 의미를 가지는지 추론해 주세요."
  예) "탕감복귀 섭리를 현대 사회에 어떻게 적용할 수 있을까요?"
  예) "원리관과 통일사상의 차이는 무엇입니까?"

- meta: 가정연합 말씀 범위 밖의 질문. 자기소개, 일반 인사, 시스템/외부 비교 등 답변 범위 외.
  예) "너는 누구야?"
  예) "오늘 날씨 어때?"
  예) "ChatGPT랑 뭐가 달라?"

[출력 규칙]
- 다음 4개 단어 중 정확히 하나만 출력합니다: factoid | conceptual | reasoning | meta
- 다른 텍스트, 설명, 부호 일체 금지
- 판단이 어려우면 conceptual 을 선택합니다
"""


def _normalize_response(raw: str) -> Intent:
    """LLM 응답 문자열을 4 라벨 중 하나로 정규화한다.

    매칭 실패 시 DEFAULT_INTENT 반환.
    """
    if not raw:
        return DEFAULT_INTENT
    cleaned = raw.strip().lower()
    # 한 단어 응답을 기대하지만 LLM 이 부가 텍스트를 붙일 수도 있어 부분 매칭 허용.
    for label in INTENT_LABELS:
        if cleaned == label or cleaned.startswith(label) or f" {label}" in f" {cleaned}":
            return label
    return DEFAULT_INTENT


async def classify_intent(query: str, *, enabled: bool = True) -> Intent:
    """사용자 질문을 4 intent 중 하나로 분류한다.

    enabled=False 면 LLM 호출 없이 DEFAULT_INTENT 반환.
    LLM 호출 실패/타임아웃/빈 응답/매칭 실패 시 모두 DEFAULT_INTENT 반환.

    Args:
        query: 사용자 원본 쿼리.
        enabled: chatbot 의 intent_classifier_enabled 토글. False 시 즉시 default.

    Returns:
        4 라벨 중 하나 ("factoid"|"conceptual"|"reasoning"|"meta").
    """
    if not enabled:
        return DEFAULT_INTENT
    try:
        raw = await asyncio.wait_for(
            generate_text(
                prompt=query,
                system_instruction=INTENT_CLASSIFIER_SYSTEM_PROMPT,
                model=MODEL_GENERATE,
            ),
            timeout=INTENT_TIMEOUT_SECONDS,
        )
        intent = _normalize_response(raw)
        logger.info(
            "intent_classifier: query=%r raw=%r intent=%s",
            query[:80],
            (raw or "").strip()[:30],
            intent,
        )
        return intent
    except asyncio.TimeoutError:
        logger.warning(
            "intent_classifier: 타임아웃 (%.1fs 초과), 기본 intent 반환 | query=%r",
            INTENT_TIMEOUT_SECONDS,
            query[:80],
        )
        return DEFAULT_INTENT
    except Exception as exc:
        logger.warning(
            "intent_classifier: LLM 호출 실패, 기본 intent 반환 | query=%r error=%s",
            query[:80],
            exc,
        )
        return DEFAULT_INTENT
