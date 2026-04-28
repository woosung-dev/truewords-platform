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
import unicodedata

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


# C3 + M4 — 위기 키워드 (DIRECT 좁힘 + EMOTIONAL 확장).
#
# **DIRECT (high signal, 사용자 명시 모드 override)**: 명백한 자해/죽음 의도만.
# 학술/전문 질문 false positive 회수 (Codex review #2 권고 — `이만 됐`, `더는 못`,
# `삶의 의미가 없` 등 모호 표현은 EMOTIONAL 로 이동).
#
# **EMOTIONAL (medium signal, 사용자 명시 모드 *보존*, 미설정 시만 pastoral)**.
# 정서 표현 + 청소년 은어 + 모호한 위기 신호.
_PASTORAL_KEYWORDS_DIRECT: tuple[str, ...] = (
    # 명백한 자해/죽음 의도 (한국어)
    "죽고 싶",
    "자살",
    "사라지고 싶",
    "끝내버리",
    "내가 사라지면",
    # 영어 명시 표현
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
    # M4 — DIRECT 에서 이동 (모호 표현, 사용자 학술 질문에서도 출현 가능)
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
    "끝내고 싶",
    # 청소년 은어 (medium signal)
    "갓생 안",
    "현타",
    "현생 망",
    "존버 한계",
    "번아웃",
)


def _normalize_for_keyword_match(query: str) -> str:
    """M3 — 키워드 매칭용 정규화.

    - NFC 정규화: macOS / iOS clipboard 의 한글 NFD 우회 방어 (Sonnet review #2).
    - 소문자 + 공백 압축.
    """
    if not query:
        return ""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", query).lower())


def _matches_pastoral_keyword(query: str) -> bool:
    """C3 + M3 — 위기/정서 키워드 매칭. NFC 정규화 + 소문자."""
    if not query:
        return False
    normalized = _normalize_for_keyword_match(query)
    for kw in (*_PASTORAL_KEYWORDS_DIRECT, *_PASTORAL_KEYWORDS_EMOTIONAL):
        if kw.lower() in normalized:
            return True
    return False


def _matches_high_signal_crisis(query: str) -> bool:
    """B5 + M3 — 사용자 명시 페르소나를 override 할 수준의 강한 위기 신호.

    DIRECT 키워드만 매칭 (M4 로 좁혀진 — 명백한 자해/죽음 의도). EMOTIONAL 은
    일반 표현일 가능성 → override 대상 아님. NFC 정규화 + 소문자 적용 (M3).
    """
    if not query:
        return False
    normalized = _normalize_for_keyword_match(query)
    return any(kw.lower() in normalized for kw in _PASTORAL_KEYWORDS_DIRECT)


def _find_first_direct_keyword(query: str) -> str | None:
    """M1 — 매칭된 DIRECT 키워드 식별 (영속화용 crisis_trigger 값)."""
    if not query:
        return None
    normalized = _normalize_for_keyword_match(query)
    for kw in _PASTORAL_KEYWORDS_DIRECT:
        if kw.lower() in normalized:
            return kw
    return None


def resolve_answer_mode(
    *,
    requested_mode: str | None,
    intent: Intent | None,
    query: str,
) -> tuple[str, bool, str | None]:
    """답변 모드 결정 우선순위 (P0-E + B5 + M1).

    Returns:
        (mode, overridden, crisis_trigger):
        - mode: 최종 답변 모드.
        - overridden: True 면 사용자 명시 모드를 위기 신호로 덮어씀 (UI 노티).
        - crisis_trigger: 매칭된 DIRECT 키워드 텍스트 또는 ``"intent:crisis"`` 또는 ``None``
          (M1 측정 — session_messages 영속화).

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
    direct_kw = _find_first_direct_keyword(query)
    if direct_kw is not None or intent == "crisis":  # type: ignore[comparison-overlap]
        overridden = (
            requested_mode in valid_modes and requested_mode != "pastoral"
        )
        trigger = direct_kw if direct_kw is not None else "intent:crisis"
        return "pastoral", overridden, trigger

    if requested_mode in valid_modes:
        return requested_mode, False, None  # type: ignore[return-value]

    # 미설정: 약한 정서 키워드 → pastoral (override 아님)
    if _matches_pastoral_keyword(query):
        return "pastoral", False, "emotional"
    if intent == "reasoning":
        return "theological", False, None
    return "standard", False, None


# P0-E + P1-G — 모드/강조점별 톤 suffix (B-minimal wiring, 2026-04-29).
# system prompt 끝에 한 문장 분기 append 로 LLM 톤 차별화. 운영자가 5x5 = 25개
# system prompt 를 작성할 필요 없이 "강한 시그널 한 문장" 만으로도 Gemini 2.5
# Flash 가 톤을 분명히 분기한다. 향후 도메인 전문가 검수 시 정교화 가능.
_MODE_TONE_SUFFIX: dict[str, str] = {
    "standard": "",  # 기본 톤 그대로
    # pastoral 은 PASTORAL_HOTLINE_NOTICE 가 별도로 append (1393 안내).
    "pastoral": "",
    "theological": (
        "\n\n[톤] 원리·교리에 깊이 있는 신학적 해설을 우선합니다. "
        "관련 원리 용어와 출처를 분명히 제시하세요."
    ),
    "beginner": (
        "\n\n[톤] 신앙의 기초부터 쉬운 말로 짧고 친절하게 설명하세요. "
        "전문 용어는 풀어 쓰고, 답변은 핵심 위주로 간결하게."
    ),
    "kids": (
        "\n\n[톤] 어린이 눈높이로 짧고 따뜻하게, 비유와 이야기로 설명하세요. "
        "어려운 용어는 피하고 친근한 어조로 답변합니다."
    ),
}

_EMPHASIS_SUFFIX: dict[str, str] = {
    "all": "",  # 균형 — 추가 강조 없음
    "principle": (
        "\n\n[강조점] 통일원리·교리 기반의 체계적 설명을 우선합니다."
    ),
    "providence": (
        "\n\n[강조점] 섭리 시대 흐름과 후천기 의미를 중심으로 답변합니다."
    ),
    "family": (
        "\n\n[강조점] 참가정·축복·가정연합 관점을 중심으로 답변합니다."
    ),
    "youth": (
        "\n\n[강조점] 청년 신앙 생활과 실천 적용을 중심으로 답변합니다."
    ),
}


def select_system_prompt(
    *,
    generation_config: GenerationConfig,
    answer_mode: str,
    emphasis: str | None = None,
) -> str:
    """모드별 + 강조점별 system prompt 선택 (P0-E + P1-G B-minimal wiring).

    1. ``system_prompt_by_mode`` 가 비어있으면 default ``system_prompt`` 사용.
    2. ``_MODE_TONE_SUFFIX`` 에서 모드별 톤 가이드 한 문장 append.
    3. ``_EMPHASIS_SUFFIX`` 에서 강조점별 한 문장 append (None / "all" 이면 skip).
    4. pastoral 일 때만 ``PASTORAL_HOTLINE_NOTICE`` 추가 동봉 (1393 안내).
    """
    base: str = generation_config.system_prompt
    by_mode = generation_config.system_prompt_by_mode or {}
    chosen = by_mode.get(answer_mode, base)

    # 모드 톤 suffix
    mode_suffix = _MODE_TONE_SUFFIX.get(answer_mode, "")
    if mode_suffix and mode_suffix not in chosen:
        chosen = chosen + mode_suffix

    # 강조점 suffix
    if emphasis is not None:
        emp_suffix = _EMPHASIS_SUFFIX.get(emphasis, "")
        if emp_suffix and emp_suffix not in chosen:
            chosen = chosen + emp_suffix

    # pastoral 핫라인 안내 (시스템 프롬프트 끝, 답변 후처리는 ensure_hotline_in_answer)
    if answer_mode == "pastoral" and PASTORAL_HOTLINE_NOTICE not in chosen:
        chosen = chosen + PASTORAL_HOTLINE_NOTICE
    return chosen


def ensure_hotline_in_answer(answer: str) -> str:
    """B4 — pastoral 답변에 hotline 강제 append (PoC hotfix: 무조건 append).

    이전 구현은 답변에 1393/1577-0199 substring 이 있으면 통과시켰지만, Codex
    review #2 가 지적한 false-positive 위험 (예: "보고서 1393 번" 등 무관한
    컨텍스트의 1393) 으로 footer 가 누락될 수 있었다.

    PoC 단계 안전 우선 정책: pastoral 답변은 **항상** PASTORAL_HOTLINE_FOOTER
    를 append. idempotent — 답변에 이미 footer 가 있으면 중복 추가 안 함.
    """
    if not answer:
        return PASTORAL_HOTLINE_FOOTER.lstrip("\n")
    # idempotent — 이미 footer 가 박혀 있으면 그대로 반환 (string 포함 검사).
    footer_marker = PASTORAL_HOTLINE_FOOTER.strip().split("\n")[1]  # "💙 즉각적인 도움이..."
    if footer_marker in answer:
        return answer
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

        answer_mode, persona_overridden, crisis_trigger = resolve_answer_mode(
            requested_mode=requested_mode,
            intent=ctx.intent,
            query=ctx.request.query,
        )
        ctx.resolved_answer_mode = answer_mode
        # B5 — UI 노티 + 영속화. ChatContext 가 정식 필드로 보유.
        ctx.persona_overridden = persona_overridden
        # M1 — 위기 매칭 origin 영속화 (PersistStage 가 session_messages 에 wire).
        ctx.crisis_trigger = crisis_trigger

        # P1-G — 사용자 명시 강조점도 함께 전달 (None 또는 "all" 이면 추가 분기 없음).
        emphasis = getattr(ctx.request, "theological_emphasis", None)
        system_prompt = select_system_prompt(
            generation_config=gen_cfg,
            answer_mode=answer_mode,
            emphasis=emphasis,
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
