"""B4/B5/C3 — 위기 라우팅 안전성 강화 단위 테스트."""

from __future__ import annotations

import pytest

from app.modules.chat.pipeline.stages.generation import (
    PASTORAL_HOTLINE_FOOTER,
    ensure_hotline_in_answer,
    resolve_answer_mode,
    select_system_prompt,
)
from app.modules.chat.prompt import MODE_MODULES
from app.modules.chatbot.runtime_config import GenerationConfig


class TestC3KeywordExpansion:
    """C3 — 위기 키워드 셋 확장 (직접/간접/은어/영어)."""

    def test_direct_korean_phrase(self) -> None:
        mode, _, _trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="죽고 싶어요"
        )
        assert mode == "pastoral"

    def test_indirect_korean_phrase(self) -> None:
        """기존 11개에서 누락된 간접 표현 — 본 PR 의 핵심 확장."""
        mode, _, _trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="세상이 너무 무거워요"
        )
        assert mode == "pastoral"

    def test_indirect_phrase_meaningless(self) -> None:
        mode, _, _trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="삶의 의미가 없어요"
        )
        assert mode == "pastoral"

    def test_korean_youth_slang(self) -> None:
        mode, _, _trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="요즘 갓생 안 됨, 너무 번아웃"
        )
        assert mode == "pastoral"

    def test_english_direct(self) -> None:
        mode, _, _trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="I want to die"
        )
        assert mode == "pastoral"

    def test_emotional_keyword_to_pastoral(self) -> None:
        mode, _, _trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="요즘 너무 우울해요"
        )
        assert mode == "pastoral"

    def test_normal_query_stays_standard(self) -> None:
        mode, _, _trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="원리란 무엇입니까?"
        )
        assert mode == "standard"


class TestB5PersonaOverride:
    """B5 — 사용자 명시 페르소나여도 강한 위기 신호 시 pastoral 강제."""

    def test_explicit_theological_overridden_by_crisis(self) -> None:
        """신학자 모드 켰어도 '죽고 싶어요' 입력 시 pastoral 강제."""
        mode, overridden, _trigger = resolve_answer_mode(
            requested_mode="theological",
            intent="reasoning",
            query="죽고 싶어요. 신학적으로 자살은 어떻게 봐야 하나요?",
        )
        assert mode == "pastoral"
        assert overridden is True

    def test_explicit_kids_overridden_by_crisis(self) -> None:
        mode, overridden, _trigger = resolve_answer_mode(
            requested_mode="kids",
            intent=None,
            query="사라지고 싶어",
        )
        assert mode == "pastoral"
        assert overridden is True

    def test_pastoral_mode_not_marked_as_override(self) -> None:
        """이미 pastoral 이면 override 가 아님."""
        mode, overridden, _trigger = resolve_answer_mode(
            requested_mode="pastoral",
            intent=None,
            query="죽고 싶어요",
        )
        assert mode == "pastoral"
        assert overridden is False

    def test_explicit_mode_not_overridden_by_emotional_only(self) -> None:
        """약한 정서 키워드 ('우울', '힘들') 만으로는 사용자 명시 모드 보존."""
        mode, overridden, _trigger = resolve_answer_mode(
            requested_mode="theological",
            intent=None,
            query="우울할 때 신앙으로 어떻게 극복하나요?",
        )
        assert mode == "theological"
        assert overridden is False

    def test_m4_explicit_mode_preserved_for_ambiguous_phrase(self) -> None:
        """M4 — 모호 표현은 EMOTIONAL 로 이동, 사용자 명시 모드 보존."""
        mode, overridden, _trigger = resolve_answer_mode(
            requested_mode="theological",
            intent=None,
            query="더는 못 버티겠어요. 영적 고갈은 어떻게 회복하나요?",
        )
        assert mode == "theological"
        assert overridden is False

    def test_m4_ambiguous_phrase_routes_pastoral_when_no_mode(self) -> None:
        """모호 표현이 EMOTIONAL 이지만 미설정 시엔 여전히 pastoral 라우팅."""
        mode, overridden, _trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="삶의 의미가 없어요"
        )
        assert mode == "pastoral"
        assert overridden is False  # EMOTIONAL 은 override 아님

    def test_m3_nfd_unicode_normalized(self) -> None:
        """M3 — macOS/iOS NFD 한글 입력도 매칭 (NFC 정규화)."""
        import unicodedata
        nfd_query = unicodedata.normalize("NFD", "죽고 싶어요")
        # NFD 자모 분리 상태에서도 키워드 매칭 성공해야 함
        mode, overridden, _trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query=nfd_query
        )
        assert mode == "pastoral"

    def test_intent_crisis_overrides_explicit_mode(self) -> None:
        """IntentClassifier 가 crisis 라벨 도입 시에도 override."""
        mode, overridden, _trigger = resolve_answer_mode(
            requested_mode="theological",
            intent="crisis",  # type: ignore[arg-type]
            query="요즘 어려운 시기를 보내고 있어요",
        )
        assert mode == "pastoral"
        assert overridden is True


class TestB4HotlineEnforced:
    """B4 — pastoral 답변에 hotline footer 강제 append (PoC: 무조건 append)."""

    def test_answer_with_inline_1393_still_gets_footer(self) -> None:
        """PoC 정책: LLM 이 inline 으로 1393 만 언급해도 footer 박스 강제 append.

        이전 정책은 1393 substring 있으면 통과시켰으나, false positive 위험
        (예: "보고서 1393 번") 으로 footer 누락 가능. 안전 우선 정책으로 전환.
        """
        original = "지금 많이 힘드시군요. 1393 으로 연락해보세요."
        result = ensure_hotline_in_answer(original)
        assert result.startswith(original)
        # footer 박스 자체는 무조건 추가됨
        assert "💙 즉각적인 도움이 필요하시다면" in result

    def test_answer_without_hotline_appends_footer(self) -> None:
        original = "지금 많이 힘드시군요. 함께 천천히 나눠봐요."
        result = ensure_hotline_in_answer(original)
        assert result.startswith(original)
        assert "1393" in result
        assert "1577-0199" in result
        assert PASTORAL_HOTLINE_FOOTER.strip() in result

    def test_empty_answer_returns_footer(self) -> None:
        result = ensure_hotline_in_answer("")
        assert "1393" in result

    def test_idempotent_when_already_appended(self) -> None:
        """이미 footer 박스가 있으면 중복 append 안 함."""
        with_footer = "위로 답변" + PASTORAL_HOTLINE_FOOTER
        result = ensure_hotline_in_answer(with_footer)
        # footer 박스는 정확히 한 번만
        assert result.count("💙 즉각적인 도움이 필요하시다면") == 1
        assert result == with_footer  # 변경되지 않음


class TestModeRoutingWiring:
    """v3 옵션 C — 모드별 본문 모듈이 system prompt 에 실제 합성된다.

    이전 한 줄 suffix 방식 (_MODE_TONE_SUFFIX) 폐기. 강조점(emphasis) 인자 폐기.
    """

    def _cfg(self) -> GenerationConfig:
        return GenerationConfig(system_prompt="기본 시스템 프롬프트")

    def test_standard_mode_appends_module(self) -> None:
        result = select_system_prompt(
            generation_config=self._cfg(), answer_mode="standard"
        )
        # BASE 본문 + standard 모듈이 합성되어야 함
        assert "기본 시스템 프롬프트" in result
        assert MODE_MODULES["standard"].split("\n", 1)[0] in result

    def test_theological_mode_appends_module(self) -> None:
        result = select_system_prompt(
            generation_config=self._cfg(), answer_mode="theological"
        )
        assert "기본 시스템 프롬프트" in result
        assert "신학자 모드" in result
        # standard 모듈 본문은 들어있지 않아야 함 — 모드별 분리 확인
        assert MODE_MODULES["standard"].split("\n", 1)[0] not in result

    def test_beginner_mode_appends_module(self) -> None:
        result = select_system_prompt(
            generation_config=self._cfg(), answer_mode="beginner"
        )
        assert "초신자 모드" in result

    def test_kids_mode_appends_module(self) -> None:
        result = select_system_prompt(
            generation_config=self._cfg(), answer_mode="kids"
        )
        assert "어린이 모드" in result

    def test_pastoral_mode_includes_hotline(self) -> None:
        """목회상담 모듈 본문에 1393 안내가 들어있어야 함."""
        result = select_system_prompt(
            generation_config=self._cfg(), answer_mode="pastoral"
        )
        assert "1393" in result
        assert "목회상담 모드" in result

    def test_modes_yield_distinct_prompts(self) -> None:
        """각 모드별 합성 결과가 서로 달라야 한다 (옵션 C 강력 적용 보증)."""
        cfg = self._cfg()
        outputs = {
            mode: select_system_prompt(generation_config=cfg, answer_mode=mode)
            for mode in ("standard", "theological", "pastoral", "beginner", "kids")
        }
        assert len(set(outputs.values())) == 5

    def test_persona_placeholder_substituted(self) -> None:
        """compose_system_prompt 가 {persona} placeholder 를 persona_name 으로 치환."""
        cfg = GenerationConfig(
            system_prompt="안녕 {persona}, 답변하세요.",
            persona_name="지식이",
        )
        result = select_system_prompt(
            generation_config=cfg, answer_mode="standard"
        )
        assert "안녕 지식이, 답변하세요." in result


class TestResolveModeReturnsTuple:
    """API 변경 — resolve_answer_mode 가 (mode, overridden, crisis_trigger) 3-tuple 반환 (M1)."""

    def test_returns_3_tuple(self) -> None:
        result = resolve_answer_mode(
            requested_mode=None, intent=None, query="test"
        )
        assert isinstance(result, tuple)
        assert len(result) == 3
        mode, overridden, trigger = result
        assert isinstance(mode, str)
        assert isinstance(overridden, bool)
        # standard 일 땐 trigger=None
        assert trigger is None

    def test_crisis_trigger_returns_keyword(self) -> None:
        """M1 — DIRECT 매칭 시 crisis_trigger 가 매칭된 키워드 텍스트."""
        _, _, trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="죽고 싶어요"
        )
        assert trigger == "죽고 싶"

    def test_crisis_trigger_returns_intent_when_intent_crisis(self) -> None:
        """M1 — intent='crisis' 만 있으면 trigger='intent:crisis'."""
        _, _, trigger = resolve_answer_mode(
            requested_mode=None,
            intent="crisis",  # type: ignore[arg-type]
            query="일반 질문",
        )
        assert trigger == "intent:crisis"

    def test_crisis_trigger_emotional_returns_label(self) -> None:
        """M1 — EMOTIONAL 매칭 시 trigger='emotional'."""
        _, _, trigger = resolve_answer_mode(
            requested_mode=None, intent=None, query="요즘 우울해요"
        )
        assert trigger == "emotional"
