"""GenerationStage — LLM 답변 생성 (동기). intent 별 컨텍스트 슬라이스 분기 + 모드별 system prompt 라우팅 (P0-E).

generate_answer 는 src.chat.generator 의 alias 로 모듈 attribute 로 보존한다 (
다수의 테스트가 'src.chat.pipeline.stages.generation.generate_answer' 경로로
patch 하기 때문).
"""

from __future__ import annotations

import logging

from src.chat.generator import generate_answer
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.chatbot.runtime_config import GenerationConfig
from src.search.intent_classifier import Intent, generation_context_slice_for

logger = logging.getLogger(__name__)

# P0-E — 한국 자살예방 상담전화. pastoral 모드 system prompt 끝에 자동 동봉.
PASTORAL_HOTLINE_NOTICE = (
    "\n\n[안내] 자살·위기 등 즉각적인 도움이 필요한 경우, "
    "자살예방상담전화 1393(24시간 무료) 으로 연락하세요."
)

# 정서/위기 키워드 — IntentClassifier 결과만으로 부족할 때 보조 매칭.
# intent="reasoning" 으로 분류된 위기 질문도 pastoral 로 끌어오기 위함.
_PASTORAL_KEYWORDS: tuple[str, ...] = (
    "힘들",
    "우울",
    "슬프",
    "외로",
    "괴로",
    "죽고 싶",
    "자살",
    "위기",
    "절망",
    "불안",
    "두려",
)


def _matches_pastoral_keyword(query: str) -> bool:
    if not query:
        return False
    return any(kw in query for kw in _PASTORAL_KEYWORDS)


def resolve_answer_mode(
    *,
    requested_mode: str | None,
    intent: Intent | None,
    query: str,
) -> str:
    """답변 모드 결정 우선순위 (P0-E).

    1. 사용자가 명시한 answer_mode → 그대로 사용
    2. 미설정 + intent=crisis(현행 라벨에 없음 — keyword fallback) 또는 정서 키워드 매치 → "pastoral"
    3. 미설정 + intent=reasoning → "theological"
    4. 그 외 → "standard"
    """
    if requested_mode in {"standard", "theological", "pastoral", "beginner", "kids"}:
        return requested_mode  # type: ignore[return-value]

    # intent 라벨에 'crisis' 가 추가되면 우선 처리.
    if intent == "crisis":  # type: ignore[comparison-overlap]
        return "pastoral"
    if _matches_pastoral_keyword(query):
        return "pastoral"
    if intent == "reasoning":
        return "theological"
    return "standard"


def select_system_prompt(
    *,
    generation_config: GenerationConfig,
    answer_mode: str,
) -> str:
    """모드별 system prompt 선택. pastoral 일 때 1393 핫라인 안내 자동 동봉.

    system_prompt_by_mode 가 비어있거나 해당 키 없으면 default system_prompt 사용.
    """
    base: str = generation_config.system_prompt
    by_mode = generation_config.system_prompt_by_mode or {}
    chosen = by_mode.get(answer_mode, base)
    if answer_mode == "pastoral" and PASTORAL_HOTLINE_NOTICE not in chosen:
        chosen = chosen + PASTORAL_HOTLINE_NOTICE
    return chosen


class GenerationStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        slice_n = generation_context_slice_for(ctx.intent)
        context_results = ctx.results[:slice_n]

        # P0-E — 답변 모드 결정 + system prompt 라우팅.
        # ChatRequest.answer_mode 는 W2-③ 영역. 아직 머지 안 됐을 수 있으므로 안전 접근.
        requested_mode = getattr(ctx.request, "answer_mode", None)
        gen_cfg = ctx.runtime_config.generation if ctx.runtime_config else None

        if gen_cfg is None:
            # runtime_config 없으면 기존 동작 유지 (legacy 경로). 원본과 동일한
            # 직접 호출 — 테스트 patch("...generation.generate_answer") 가 그대로 적용됨.
            ctx.answer = await generate_answer(
                ctx.request.query,
                context_results,
                generation_config=None,
            )
            ctx.resolved_answer_mode = None
            ctx.pipeline_state = PipelineState.GENERATED
            return ctx

        answer_mode = resolve_answer_mode(
            requested_mode=requested_mode,
            intent=ctx.intent,
            query=ctx.request.query,
        )
        ctx.resolved_answer_mode = answer_mode
        system_prompt = select_system_prompt(
            generation_config=gen_cfg,
            answer_mode=answer_mode,
        )

        # GenerationConfig 는 frozen — model_copy 로 system_prompt 만 교체한 임시 객체 사용.
        gen_cfg_for_call = gen_cfg.model_copy(update={"system_prompt": system_prompt})

        ctx.answer = await generate_answer(
            ctx.request.query,
            context_results,
            generation_config=gen_cfg_for_call,
        )
        ctx.pipeline_state = PipelineState.GENERATED
        return ctx
