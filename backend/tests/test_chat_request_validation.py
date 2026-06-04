"""ChatRequest 참여자 필드 검증 — max_length 방어 (레드팀 시연, review fix)."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.chat.schemas import ChatRequest


def test_participant_fields_accept_within_limit():
    req = ChatRequest(query="안녕", participant_name="홍길동", participant_category="청년부")
    assert req.participant_name == "홍길동"
    assert req.participant_category == "청년부"


def test_participant_fields_optional():
    req = ChatRequest(query="안녕")
    assert req.participant_name is None
    assert req.participant_category is None


def test_participant_name_over_128_rejected():
    """클라이언트 maxLength 우회로 129자 전송 시 422(ValidationError) — DB DataError(500) 방지."""
    with pytest.raises(ValidationError):
        ChatRequest(query="안녕", participant_name="가" * 129)


def test_participant_category_over_128_rejected():
    with pytest.raises(ValidationError):
        ChatRequest(query="안녕", participant_category="x" * 129)
