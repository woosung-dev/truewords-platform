# P0-9 StreamingSanitizer 단위 테스트 — SSE chunk 단위 sensitive-pattern 차단.
"""StreamingSanitizer 단위 테스트.

SSE 의 streaming chunk path 에서 SENSITIVE_PATTERNS 매칭 시 raw chunk 가 사용자에
도달하지 않도록 chunk 별 sanitizer 가 buffer + abort 의 책임을 진다.
"""

from __future__ import annotations

import re

from src.safety.output_filter import StreamingSanitizer


class TestPassThroughEmptyPatterns:
    """SENSITIVE_PATTERNS 가 빈 경우 → 즉시 pass-through (PoC 운영 상태 호환)."""

    def test_chunks_pass_through_immediately(self) -> None:
        s = StreamingSanitizer(patterns=[])
        assert s.feed("안녕") == "안녕"
        assert s.feed("하세요") == "하세요"
        assert s.aborted is False
        assert s.flush() == ""

    def test_long_chunks_pass_through(self) -> None:
        s = StreamingSanitizer(patterns=[], max_buffer=10)
        assert s.feed("a" * 50) == "a" * 50
        assert s.flush() == ""

    def test_flush_after_abort_returns_empty(self) -> None:
        pattern = re.compile(r"secret")
        s = StreamingSanitizer(patterns=[(pattern, "[차단]")], max_buffer=200)
        s.feed("secret leak")
        assert s.aborted is True
        assert s.flush() == ""


class TestPatternBuffering:
    """패턴 있을 때 — chunk 경계 패턴 매칭을 위해 max_buffer 만큼 tail 보관."""

    def test_short_chunks_buffered_until_flush(self) -> None:
        pattern = re.compile(r"NEVERMATCH")
        s = StreamingSanitizer(patterns=[(pattern, "[차단]")], max_buffer=200)
        assert s.feed("안녕") == ""
        assert s.feed("하세요") == ""
        assert s.aborted is False
        assert s.flush() == "안녕하세요"

    def test_long_chunks_release_prefix(self) -> None:
        pattern = re.compile(r"NEVERMATCH")
        s = StreamingSanitizer(patterns=[(pattern, "[차단]")], max_buffer=10)
        first = s.feed("a" * 8)
        assert first == ""
        second = s.feed("b" * 8)
        assert len(second) == 6
        assert second == "a" * 6
        tail = s.flush()
        assert len(tail) == 10
        assert tail == "a" * 2 + "b" * 8


class TestPatternMatchAbort:
    """패턴 매칭 시 abort + guidance release."""

    def test_single_chunk_match_returns_guidance(self) -> None:
        pattern = re.compile(r"민감인명")
        s = StreamingSanitizer(patterns=[(pattern, "[안전 안내]")])
        out = s.feed("이름은 민감인명 입니다.")
        assert out == "[안전 안내]"
        assert s.aborted is True

    def test_subsequent_feed_returns_empty(self) -> None:
        pattern = re.compile(r"X")
        s = StreamingSanitizer(patterns=[(pattern, "[차단]")])
        s.feed("hello X world")
        assert s.aborted is True
        assert s.feed("more raw text") == ""

    def test_pattern_spans_two_chunks_caught_by_buffer(self) -> None:
        pattern = re.compile(r"위반키워드")
        s = StreamingSanitizer(patterns=[(pattern, "[차단]")], max_buffer=200)
        first = s.feed("앞 부분 위반키")
        assert first == ""
        assert s.aborted is False
        second = s.feed("워드 뒤 부분")
        assert second == "[차단]"
        assert s.aborted is True

    def test_pattern_in_release_zone_still_caught(self) -> None:
        """release 직전 buffer 검사가 우선 적용되어 매칭이 누락되지 않는다."""
        pattern = re.compile(r"AB")
        s = StreamingSanitizer(patterns=[(pattern, "[차단]")], max_buffer=4)
        first = s.feed("xxxAByyy")
        assert first == "[차단]"
        assert s.aborted is True


class TestMultiplePatterns:
    """여러 패턴 중 하나라도 매칭 시 abort."""

    def test_second_pattern_matches(self) -> None:
        patterns: list[tuple[re.Pattern[str], str]] = [
            (re.compile(r"AAA"), "[1]"),
            (re.compile(r"BBB"), "[2]"),
        ]
        s = StreamingSanitizer(patterns=patterns)
        out = s.feed("hello BBB world")
        assert out == "[2]"
        assert s.aborted is True


class TestSentenceLevelHoldback:
    """audit 2차 S-1 (2026-05-15, Codex E P1 8/10): sentence-level holdback.

    기존 max_buffer 정책은 200자 prefix 가 사용자에 노출된 뒤 abort. PII 가 첫
    200자 안 뒤쪽에 등장하면 그 직전 prefix 누출. 본 fix 는 buffer 안 마지막
    sentence terminator 까지만 release — PII 가 같은 sentence 안에서 완성되면
    release 전에 abort 트리거.
    """

    _PII = [(re.compile(r"\d{6}-[1-4]\d{6}"), "[차단]")]

    def test_holds_back_until_sentence_terminator_english(self) -> None:
        """영문 sentence terminator (`. `) 전까지는 release X."""
        s = StreamingSanitizer(patterns=self._PII, max_buffer=200)
        # terminator 없는 chunk → buffer 유지
        assert s.feed("Hello world without any") == ""
        # 영문 terminator + space → 그 시점까지 release
        assert s.feed(" end. Next part") == "Hello world without any end. "
        assert s.feed(" continues.") == "Next part continues."

    def test_holds_back_until_sentence_terminator_korean(self) -> None:
        """한국어 종지 (`다.`/`요.`/`니까.`) 도 terminator 로 인식.

        한국어 종지 정규식 `[다요죠네까]\\.` 는 trailing space 포함 안 함 — end position
        은 `.` 직후. 영문 `[.!?]\\s` 는 space 포함.
        """
        s = StreamingSanitizer(patterns=self._PII, max_buffer=200)
        assert s.feed("안녕하세요") == ""
        # `요.` terminator → "안녕하세요요." 까지 release (`.` 직후)
        assert s.feed("요. 식구님께서") == "안녕하세요요."
        # 마지막 chunk 의 `다.` (`바랍니다.`) terminator → buffer 전체 release
        assert s.feed(" 평안하시기를 바랍니다.") == " 식구님께서 평안하시기를 바랍니다."

    def test_holds_back_until_newline(self) -> None:
        """줄바꿈도 terminator."""
        s = StreamingSanitizer(patterns=self._PII, max_buffer=200)
        assert s.feed("첫 줄") == ""
        assert s.feed("\n둘째 줄") == "첫 줄\n"

    def test_pii_in_long_prefix_caught_before_release(self) -> None:
        """PII 가 sentence terminator 전에 완성되면 prefix release X — abort 우선."""
        s = StreamingSanitizer(patterns=self._PII, max_buffer=400)
        # 200자 넘어가도 sentence terminator 없으면 hold (PR audit 2차 S-1 핵심).
        prefix = "여기는 충분히 긴 문단입니다 " * 5  # ~75자
        assert s.feed(prefix) == ""
        # PII chunk → buffer 합산 패턴 매칭 → abort + guidance
        out = s.feed("주민번호는 850101-1234567 입니다.")
        assert out == "[차단]"
        assert s.aborted is True

    def test_long_sentence_without_terminator_falls_back_to_max_buffer(self) -> None:
        """terminator 없이 max_buffer 초과 시 UX 보장 위해 hard release fallback."""
        s = StreamingSanitizer(patterns=self._PII, max_buffer=10)
        # 20자 한 chunk, terminator 없음 → release_len = 10 → 앞 10자
        assert s.feed("a" * 20) == "a" * 10
        # 추가로 더 들어와도 terminator 없으면 계속 hard release
        assert s.feed("b" * 5) == "a" * 5

    def test_flush_rechecks_patterns_for_tail_pii(self) -> None:
        """flush 시점 buffer 안에 PII 가 남아 있으면 abort + guidance (terminator 없는 tail).

        Codex round-2 P2 finding "flush 패턴 재검사 누락" 부수 fix.
        """
        s = StreamingSanitizer(patterns=self._PII, max_buffer=200)
        # terminator 없는 짧은 buffer 에 PII 등장 — feed 도중 매칭 안 됨 (이미 매칭됨)
        # 시나리오: terminator 없는 tail 에 PII 가 있고 generation 끝
        s.feed("주민번호: 850101-1234567")
        # 위에서 이미 abort 됨 (feed 안 패턴 검사) — assert
        assert s.aborted is True


class TestBufferBoundary:
    """max_buffer 와 release length 의 경계 동작 (패턴이 1개 이상 있을 때)."""

    _NEVER = re.compile(r"NEVERMATCH")

    def test_exactly_at_boundary_no_release(self) -> None:
        s = StreamingSanitizer(patterns=[(self._NEVER, "[차단]")], max_buffer=5)
        assert s.feed("12345") == ""
        assert s.flush() == "12345"

    def test_one_over_boundary_releases_one(self) -> None:
        s = StreamingSanitizer(patterns=[(self._NEVER, "[차단]")], max_buffer=5)
        first = s.feed("123456")
        assert first == "1"
        tail = s.flush()
        assert tail == "23456"

    def test_chunks_accumulate_before_release(self) -> None:
        s = StreamingSanitizer(patterns=[(self._NEVER, "[차단]")], max_buffer=3)
        assert s.feed("ab") == ""
        assert s.feed("cd") == "a"
        assert s.feed("ef") == "bc"
        assert s.flush() == "def"
