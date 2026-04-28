"""B4/B5/C3 — 위기 라우팅 안전성 강화 단위 테스트."""

from __future__ import annotations

import pytest

from src.chat.pipeline.stages.generation import (
    PASTORAL_HOTLINE_FOOTER,
    ensure_hotline_in_answer,
    resolve_answer_mode,
)


class TestC3KeywordExpansion:
    """C3 — 위기 키워드 셋 확장 (직접/간접/은어/영어)."""

    def test_direct_korean_phrase(self) -> None:
        mode, _ = resolve_answer_mode(
            requested_mode=None, intent=None, query="죽고 싶어요"
        )
        assert mode == "pastoral"

    def test_indirect_korean_phrase(self) -> None:
        """기존 11개에서 누락된 간접 표현 — 본 PR 의 핵심 확장."""
        mode, _ = resolve_answer_mode(
            requested_mode=None, intent=None, query="세상이 너무 무거워요"
        )
        assert mode == "pastoral"

    def test_indirect_phrase_meaningless(self) -> None:
        mode, _ = resolve_answer_mode(
            requested_mode=None, intent=None, query="삶의 의미가 없어요"
        )
        assert mode == "pastoral"

    def test_korean_youth_slang(self) -> None:
        mode, _ = resolve_answer_mode(
            requested_mode=None, intent=None, query="요즘 갓생 안 됨, 너무 번아웃"
        )
        assert mode == "pastoral"

    def test_english_direct(self) -> None:
        mode, _ = resolve_answer_mode(
            requested_mode=None, intent=None, query="I want to die"
        )
        assert mode == "pastoral"

    def test_emotional_keyword_to_pastoral(self) -> None:
        mode, _ = resolve_answer_mode(
            requested_mode=None, intent=None, query="요즘 너무 우울해요"
        )
        assert mode == "pastoral"

    def test_normal_query_stays_standard(self) -> None:
        mode, _ = resolve_answer_mode(
            requested_mode=None, intent=None, query="원리란 무엇입니까?"
        )
        assert mode == "standard"


class TestB5PersonaOverride:
    """B5 — 사용자 명시 페르소나여도 강한 위기 신호 시 pastoral 강제."""

    def test_explicit_theological_overridden_by_crisis(self) -> None:
        """신학자 모드 켰어도 '죽고 싶어요' 입력 시 pastoral 강제."""
        mode, overridden = resolve_answer_mode(
            requested_mode="theological",
            intent="reasoning",
            query="죽고 싶어요. 신학적으로 자살은 어떻게 봐야 하나요?",
        )
        assert mode == "pastoral"
        assert overridden is True

    def test_explicit_kids_overridden_by_crisis(self) -> None:
        mode, overridden = resolve_answer_mode(
            requested_mode="kids",
            intent=None,
            query="사라지고 싶어",
        )
        assert mode == "pastoral"
        assert overridden is True

    def test_pastoral_mode_not_marked_as_override(self) -> None:
        """이미 pastoral 이면 override 가 아님."""
        mode, overridden = resolve_answer_mode(
            requested_mode="pastoral",
            intent=None,
            query="죽고 싶어요",
        )
        assert mode == "pastoral"
        assert overridden is False

    def test_explicit_mode_not_overridden_by_emotional_only(self) -> None:
        """약한 정서 키워드 ('우울', '힘들') 만으로는 사용자 명시 모드 보존."""
        mode, overridden = resolve_answer_mode(
            requested_mode="theological",
            intent=None,
            query="우울할 때 신앙으로 어떻게 극복하나요?",
        )
        assert mode == "theological"
        assert overridden is False

    def test_intent_crisis_overrides_explicit_mode(self) -> None:
        """IntentClassifier 가 crisis 라벨 도입 시에도 override."""
        mode, overridden = resolve_answer_mode(
            requested_mode="theological",
            intent="crisis",  # type: ignore[arg-type]
            query="요즘 어려운 시기를 보내고 있어요",
        )
        assert mode == "pastoral"
        assert overridden is True


class TestB4HotlineEnforced:
    """B4 — pastoral 답변에 1393 강제 append (LLM omit 방어)."""

    def test_answer_with_1393_unchanged(self) -> None:
        original = "지금 많이 힘드시군요. 1393 으로 연락해보세요."
        result = ensure_hotline_in_answer(original)
        assert result == original

    def test_answer_with_1577_0199_unchanged(self) -> None:
        original = "정신건강위기상담 1577-0199 도 24시간 무료입니다."
        result = ensure_hotline_in_answer(original)
        assert result == original

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
        """이미 footer 가 있으면 중복 append 안 함."""
        with_footer = "위로 답변" + PASTORAL_HOTLINE_FOOTER
        result = ensure_hotline_in_answer(with_footer)
        # 두 번 들어가지 않아야 함
        assert result.count("1393") == 1


class TestResolveModeReturnsTuple:
    """API 변경 — resolve_answer_mode 가 (mode, overridden) tuple 반환."""

    def test_returns_tuple(self) -> None:
        result = resolve_answer_mode(
            requested_mode=None, intent=None, query="test"
        )
        assert isinstance(result, tuple)
        assert len(result) == 2
        mode, overridden = result
        assert isinstance(mode, str)
        assert isinstance(overridden, bool)
