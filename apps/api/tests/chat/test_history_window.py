"""멀티턴 이력 윈도우(select_history_window) + 프롬프트 주입 단위 테스트."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.modules.chat.history import estimate_tokens, select_history_window
from app.modules.chat.models import MessageRole, SessionMessage
from app.modules.chat.prompt import build_context_prompt
from app.modules.search.hybrid import SearchResult


def _msg(role: MessageRole, content: str) -> SessionMessage:
    m = MagicMock(spec=SessionMessage)
    m.role = role
    m.content = content
    return m


def _results() -> list[SearchResult]:
    return [
        SearchResult(text="하나님은 사랑이시다.", volume="vol_001", chunk_index=0, score=0.95),
    ]


class TestEstimateTokens:
    def test_korean_half_length(self) -> None:
        assert estimate_tokens("가나다라") == 2

    def test_minimum_one(self) -> None:
        assert estimate_tokens("") == 1
        assert estimate_tokens("가") == 1


class TestSelectHistoryWindow:
    def test_preserves_chronological_order(self) -> None:
        msgs = [
            _msg(MessageRole.USER, "질문1"),
            _msg(MessageRole.ASSISTANT, "답변1"),
            _msg(MessageRole.USER, "질문2"),
        ]
        window = select_history_window(msgs)
        assert window == [("user", "질문1"), ("assistant", "답변1"), ("user", "질문2")]

    def test_assistant_truncated(self) -> None:
        long_answer = "가" * 1000
        msgs = [_msg(MessageRole.ASSISTANT, long_answer)]
        window = select_history_window(msgs, assistant_truncate_chars=400)
        assert window[0][1] == "가" * 400 + "…"

    def test_user_not_truncated(self) -> None:
        long_query = "가" * 500
        msgs = [_msg(MessageRole.USER, long_query)]
        window = select_history_window(msgs, assistant_truncate_chars=400)
        assert window[0][1] == long_query

    def test_token_budget_drops_oldest_first(self) -> None:
        msgs = [
            _msg(MessageRole.USER, "옛" * 100),  # 50 tokens
            _msg(MessageRole.USER, "중" * 100),  # 50 tokens
            _msg(MessageRole.USER, "새" * 100),  # 50 tokens
        ]
        window = select_history_window(msgs, token_budget=100)
        assert [c[0] for _, c in window] == ["중", "새"]

    def test_max_messages_cap(self) -> None:
        msgs = [_msg(MessageRole.USER, f"질문{i}") for i in range(20)]
        window = select_history_window(msgs, max_messages=12)
        assert len(window) == 12
        assert window[-1][1] == "질문19"

    def test_latest_message_always_included_even_over_budget(self) -> None:
        msgs = [_msg(MessageRole.USER, "가" * 4000)]
        window = select_history_window(msgs, token_budget=100)
        assert len(window) == 1

    def test_empty_and_blank_messages_skipped(self) -> None:
        msgs = [_msg(MessageRole.USER, "  "), _msg(MessageRole.USER, "질문")]
        window = select_history_window(msgs)
        assert window == [("user", "질문")]


class TestBuildContextPromptHistory:
    def test_no_history_is_byte_identical_to_legacy(self) -> None:
        """history=None/빈 리스트면 기존 단일 턴 프롬프트와 문자 단위 동일 —
        기존 274+ 테스트·시맨틱 캐시 무회귀 보증의 핵심 계약."""
        results = _results()
        legacy = "말씀 문단:\n[출처: vol_001]\n하나님은 사랑이시다.\n\n질문: 사랑이란?"
        assert build_context_prompt("사랑이란?", results) == legacy
        assert build_context_prompt("사랑이란?", results, history=None) == legacy
        assert build_context_prompt("사랑이란?", results, history=[]) == legacy

    def test_history_block_prepended(self) -> None:
        history = [("user", "효자란 무엇인가요?"), ("assistant", "효자는 …입니다.")]
        prompt = build_context_prompt("그럼 어떻게 실천하나요?", _results(), history=history)
        assert prompt.startswith("이전 대화")
        assert "사용자: 효자란 무엇인가요?" in prompt
        assert "도우미: 효자는 …입니다." in prompt
        # 검색 컨텍스트·질문은 이력 뒤에 그대로 유지
        assert "말씀 문단:" in prompt
        assert prompt.endswith("질문: 그럼 어떻게 실천하나요?")
        # 근거 제한 지시 포함
        assert "말씀 문단에서" in prompt
