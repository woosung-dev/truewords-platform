"""ChatRequest 스키마 단위 테스트.

ADR-46 P0-E (answer_mode) 필드의 기본값 / 유효값 / 잘못된 값 검증.

PoC 정리 (2026-04-29) — P2-D visibility 필드 제거.
v3 개편 (2026-05-14) — P1-G theological_emphasis 5종 폐기. 호환을 위해 ChatRequest
는 ``extra="ignore"`` 로 미지정 필드를 무시한다.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.modules.chat.schemas import ChatRequest
from app.modules.chat.types import AnswerMode


class TestChatRequestDefaults:
    """신규 필드의 기본값(None) 검증."""

    def test_new_fields_default_to_none(self) -> None:
        req = ChatRequest(query="축복이란 무엇인가?")

        assert req.answer_mode is None

    def test_existing_fields_unaffected(self) -> None:
        sid = uuid.uuid4()
        req = ChatRequest(query="질문", chatbot_id="cb-1", session_id=sid)

        assert req.query == "질문"
        assert req.chatbot_id == "cb-1"
        assert req.session_id == sid
        assert req.answer_mode is None


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


class TestExtraIgnore:
    """v3 개편 — 폐기된 필드 (theological_emphasis 등) 가 와도 400 떨어지지 않는다."""

    def test_unknown_field_is_ignored(self) -> None:
        # ChatRequest 는 model_config extra="ignore" 라 알 수 없는 필드를 무시.
        req = ChatRequest.model_validate(
            {"query": "q", "theological_emphasis": "family"}
        )
        assert req.query == "q"
        # 필드 자체는 모델에 없으므로 model_dump 결과에도 포함되지 않는다.
        assert "theological_emphasis" not in req.model_dump()
