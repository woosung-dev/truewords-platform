"""GenerationStage — LLM 답변 생성 (동기). intent 별 컨텍스트 슬라이스 분기 + 모드별 system prompt 라우팅 (P0-E).

generate_answer 는 src.chat.generator 의 alias 로 모듈 attribute 로 보존한다 (
다수의 테스트가 'src.chat.pipeline.stages.generation.generate_answer' 경로로
patch 하기 때문).

# 안전 강화 (Cross-review B4/B5/C3, 2026-04-28)
- B4: pastoral 답변 후처리에서 1393 핫라인 출력 강제 보장 (LLM omit 방어).
- B5: 사용자가 명시한 페르소나여도 위기 신호 감지 시 ``pastoral`` 강제 override.
      ``ctx.persona_overridden`` 플래그를 세팅해 UI 가 노티 띄울 수 있도록 한다.
- C3: 위기 키워드 셋을 30+개로 확장. 한국어 직접/간접 표현 + 청소년 은어 + 기본 영어 표현 포함.
      장기적으로는 LLM-classifier (IntentClassifier 의 ``crisis`` 라벨) 로 승격 예정.
"""

from __future__ import annotations

import logging
import re

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

# B4 — 답변 후처리에서 강제 append 할 본문용 안내 (system prompt 의 instruction
# 와 분리). 답변 마지막 단락에 noticeable 박스 형태로 추가.
PASTORAL_HOTLINE_FOOTER = (
    "\n\n---\n"
    "💙 즉각적인 도움이 필요하시다면\n"
    "- 자살예방상담전화 1393 (24시간 무료, 익명)\n"
    "- 정신건강위기상담 1577-0199 (24시간 무료)\n"
    "혼자 견디지 마세요. 전문 상담사와 이야기 나눠보시길 권합니다."
)
# B4 — 답변에 핫라인 번호 중 하나라도 있으면 LLM 이 안내했다고 간주.
_HOTLINE_TOKENS: tuple[str, ...] = ("1393", "1577-0199")


# C3 — 위기 키워드 30+개 (직접/간접/청소년 은어/영어).
# 장기적으로는 IntentClassifier crisis 라벨 (LLM 분류) 로 대체. 현재는 cost-floor.
# false negative 확장 우선 — false positive (예: "불안" 일반어) 일부 감수.
_PASTORAL_KEYWORDS_DIRECT: tuple[str, ...] = (
    # 직접 위기 표현 (high signal)
    "죽고 싶",
    "자살",
    "사라지고 싶",
    "끝내고 싶",
    "끝내버리",
    "이만 됐",
    "더는 못",
    "더 이상 못 버티",
    "마지막 페이지",
    "삶의 의미가 없",
    "의미가 없어",
    "살 이유가 없",
    "혼자가 편",
    "세상이 무거",
    "세상이 너무 무거",
    "다 끝내",
    "다 포기",
    # 영어 직접 표현
    "want to die",
    "kill myself",
    "end it all",
    "no reason to live",
)
_PASTORAL_KEYWORDS_EMOTIONAL: tuple[str, ...] = (
    # 강한 정서 (medium signal)
    "너무 힘들",
    "우울",
    "슬프",
    "외로",
    "괴로",
    "절망",
    "공허",
    "무기력",
    # 청소년 은어 (medium signal)
    "갓생 안",
    "현타",
    "현생 망",
    "존버 한계",
    "번아웃",
)


def _matches_pastoral_keyword(query: str) -> bool:
    """C3 — 위기/정서 키워드 매칭. 정규화(소문자 + 공백 압축) 적용."""
    if not query:
        return False
    normalized = re.sub(r"\s+", " ", query.lower())
    for kw in (*_PASTORAL_KEYWORDS_DIRECT, *_PASTORAL_KEYWORDS_EMOTIONAL):
        if kw.lower() in normalized:
            return True
    return False


def _matches_high_signal_crisis(query: str) -> bool:
    """B5 — 사용자 명시 페르소나를 override 할 수준의 강한 위기 신호.

    DIRECT 키워드만 매칭 (EMOTIONAL 은 일반 표현일 가능성 → override 대상 아님).
    """
    if not query:
        return False
    normalized = re.sub(r"\s+", " ", query.lower())
    return any(kw.lower() in normalized for kw in _PASTORAL_KEYWORDS_DIRECT)


def resolve_answer_mode(
    *,
    requested_mode: str | None,
    intent: Intent | None,
    query: str,
) -> tuple[str, bool]:
    """답변 모드 결정 우선순위 (P0-E + B5).

    Returns:
        (mode, overridden) — overridden=True 면 사용자 명시 모드를 위기 신호로 덮어씀.
        UI 는 overridden=True 일 때 "위기 신호로 감지되어 상담 모드로 전환됐어요" 노티.

    Priority:
        1. 강한 위기 신호 (HIGH_SIGNAL_CRISIS) → ``pastoral`` 강제 (사용자 모드 무시 — B5)
        2. 사용자가 명시한 answer_mode → 그대로 사용
        3. 미설정 + intent="crisis" → ``pastoral``
        4. 미설정 + 정서 키워드 매치 → ``pastoral``
        5. 미설정 + intent="reasoning" → ``theological``
        6. 그 외 → ``standard``
    """
    valid_modes = {"standard", "theological", "pastoral", "beginner", "kids"}

    # B5 — 강한 위기 신호 시 사용자 모드 override.
    if _matches_high_signal_crisis(query) or intent == "crisis":  # type: ignore[comparison-overlap]
        overridden = (
            requested_mode in valid_modes and requested_mode != "pastoral"
        )
        return "pastoral", overridden

    if requested_mode in valid_modes:
        return requested_mode, False  # type: ignore[return-value]

    # 미설정: 약한 정서 키워드 → pastoral (override 아님)
    if _matches_pastoral_keyword(query):
        return "pastoral", False
    if intent == "reasoning":
        return "theological", False
    return "standard", False


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


def ensure_hotline_in_answer(answer: str) -> str:
    """B4 — pastoral 답변에 1393 또는 1577-0199 미포함 시 강제 append.

    LLM 이 system prompt 의 hotline 안내를 출력에서 omit 했을 때 코드가 보장한다.
    """
    if not answer:
        return PASTORAL_HOTLINE_FOOTER.lstrip("\n")
    has_hotline = any(token in answer for token in _HOTLINE_TOKENS)
    if has_hotline:
        return answer
    logger.warning(
        "pastoral 답변에 hotline 누락 감지 — 강제 append 적용",
        extra={"answer_length": len(answer)},
    )
    return answer + PASTORAL_HOTLINE_FOOTER


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

        answer_mode, persona_overridden = resolve_answer_mode(
            requested_mode=requested_mode,
            intent=ctx.intent,
            query=ctx.request.query,
        )
        ctx.resolved_answer_mode = answer_mode
        # B5 — UI 노티용 ctx flag (없으면 setattr — ChatContext 가 향후 정식 필드 추가)
        try:
            ctx.persona_overridden = persona_overridden  # type: ignore[attr-defined]
        except Exception:  # pragma: no cover — defensive
            setattr(ctx, "persona_overridden", persona_overridden)

        system_prompt = select_system_prompt(
            generation_config=gen_cfg,
            answer_mode=answer_mode,
        )

        # GenerationConfig 는 frozen — model_copy 로 system_prompt 만 교체한 임시 객체 사용.
        gen_cfg_for_call = gen_cfg.model_copy(update={"system_prompt": system_prompt})

        answer = await generate_answer(
            ctx.request.query,
            context_results,
            generation_config=gen_cfg_for_call,
        )

        # B4 — pastoral 모드일 때 hotline 출력 강제 보장 (LLM omit 방어).
        if answer_mode == "pastoral":
            answer = ensure_hotline_in_answer(answer)

        ctx.answer = answer
        ctx.pipeline_state = PipelineState.GENERATED
        return ctx
