"""ChatRequest 스키마 단위 테스트.

ADR-46 P0-E (answer_mode) + P1-G (theological_emphasis) 두 신규 필드의
기본값 / 유효값 / 잘못된 값을 검증한다.

PoC 정리 (2026-04-29) — P2-D visibility 필드 제거.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from src.chat.schemas import ChatRequest
from src.chat.types import AnswerMode, TheologicalEmphasis


class TestChatRequestDefaults:
    """신규 필드의 기본값(None) 검증."""

    def test_new_fields_default_to_none(self) -> None:
        req = ChatRequest(query="축복이란 무엇인가?")

        assert req.answer_mode is None
        assert req.theological_emphasis is None

    def test_existing_fields_unaffected(self) -> None:
        sid = uuid.uuid4()
        req = ChatRequest(query="질문", chatbot_id="cb-1", session_id=sid)

        assert req.query == "질문"
        assert req.chatbot_id == "cb-1"
        assert req.session_id == sid
        # 신규 필드도 정상적으로 기본값 None 유지
        assert req.answer_mode is None
        assert req.theological_emphasis is None


class TestAnswerModeLiteral:
    """P0-E answer_mode Literal 검증."""

    @pytest.mark.parametrize(
        "value",
        ["standard", "theological", "pastoral", "beginner", "kids"],
    )
    def test_valid_values(self, value: AnswerMode) -> None:
        req = ChatRequest(query="q", answer_mode=value)
        assert req.answer_mode == value

    @pytest.mark.parametrize("value", ["", "STANDARD", "child", "adult", "none"])
    def test_invalid_values_raise(self, value: str) -> None:
        with pytest.raises(ValidationError):
            ChatRequest(query="q", answer_mode=value)  # type: ignore[arg-type]


class TestTheologicalEmphasisLiteral:
    """P1-G theological_emphasis Literal 검증."""

    @pytest.mark.parametrize(
        "value",
        ["all", "principle", "providence", "family", "youth"],
    )
    def test_valid_values(self, value: TheologicalEmphasis) -> None:
        req = ChatRequest(query="q", theological_emphasis=value)
        assert req.theological_emphasis == value

    @pytest.mark.parametrize(
        "value", ["ALL", "Principle", "doctrine", "history", ""]
    )
    def test_invalid_values_raise(self, value: str) -> None:
        with pytest.raises(ValidationError):
            ChatRequest(query="q", theological_emphasis=value)  # type: ignore[arg-type]


class TestCombinedFields:
    """두 필드 동시 사용 시 정상 검증."""

    def test_two_fields_together(self) -> None:
        req = ChatRequest(
            query="가족이란 무엇인가요?",
            answer_mode="pastoral",
            theological_emphasis="family",
        )

        assert req.answer_mode == "pastoral"
        assert req.theological_emphasis == "family"
