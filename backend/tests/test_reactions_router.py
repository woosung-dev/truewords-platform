"""P1-A reactions 모델 + repository + schema 단위 테스트.

전체 통합 테스트 (HTTP) 는 chatbot_configs FK 의존 등으로 in-memory DB 셋업이
무거우므로, 본 worktree 에서는 모델 enum / 토글 시맨틱 / 스키마 검증에 집중한다.
HTTP-level e2e 는 별도 PR 에서 추가 (실제 PostgreSQL 또는 testcontainer 활용).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.chat.models import MessageReaction, MessageReactionKind
from src.chat.reactions_schemas import (
    ReactionAggregate,
    ReactionRequest,
    ReactionToggleResponse,
)


class TestEnumContract:
    """타 worktree 가 의존하는 enum 값의 안정성."""

    def test_thumbs_up_value(self) -> None:
        assert MessageReactionKind.THUMBS_UP.value == "thumbs_up"

    def test_thumbs_down_value(self) -> None:
        assert MessageReactionKind.THUMBS_DOWN.value == "thumbs_down"

    def test_save_value(self) -> None:
        assert MessageReactionKind.SAVE.value == "save"

    def test_three_kinds_only(self) -> None:
        assert {k.value for k in MessageReactionKind} == {
            "thumbs_up",
            "thumbs_down",
            "save",
        }


class TestReactionRequest:
    """B2 — user_session_id 는 cookie 발급으로 전환되어 ReactionRequest 에서 제거됨."""

    def test_valid_request(self) -> None:
        req = ReactionRequest(kind="thumbs_up")
        assert req.kind == "thumbs_up"

    def test_invalid_kind_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ReactionRequest(kind="love")  # type: ignore[arg-type]

    def test_user_session_id_not_in_request_body(self) -> None:
        """B2 보안 — user_session_id 는 schema 에서 제거됨 (서버 cookie 발급)."""
        assert "user_session_id" not in ReactionRequest.model_fields


class TestReactionAggregate:
    def test_default_zero(self) -> None:
        agg = ReactionAggregate(message_id="00000000-0000-0000-0000-000000000000")  # type: ignore[arg-type]
        assert agg.thumbs_up == 0
        assert agg.thumbs_down == 0
        assert agg.save == 0

    def test_explicit_counts(self) -> None:
        agg = ReactionAggregate(
            message_id="00000000-0000-0000-0000-000000000000",  # type: ignore[arg-type]
            thumbs_up=5,
            thumbs_down=1,
            save=3,
        )
        assert agg.thumbs_up == 5
        assert agg.save == 3


class TestReactionToggleResponse:
    def test_added_with_reaction(self) -> None:
        resp = ReactionToggleResponse(action="added", reaction=None)
        assert resp.action == "added"

    def test_invalid_action_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ReactionToggleResponse(action="updated", reaction=None)  # type: ignore[arg-type]


class TestMessageReactionModel:
    """SQLModel 객체가 정상 생성되는지 (DB 없이도 인스턴스화 가능)."""

    def test_instantiate(self) -> None:
        import uuid as _uuid

        reaction = MessageReaction(
            message_id=_uuid.uuid4(),
            user_session_id="u-1",
            kind=MessageReactionKind.THUMBS_UP,
        )
        assert reaction.kind == MessageReactionKind.THUMBS_UP
        assert reaction.user_session_id == "u-1"
