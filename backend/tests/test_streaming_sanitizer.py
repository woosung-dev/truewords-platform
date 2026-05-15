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
