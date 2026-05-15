"""log_helpers.query_fingerprint 단위 테스트.

audit 2차 S-5 (2026-05-15): 검색/재작성 로그가 raw query 를 출력해 Cloud Logging
에 PII (종교적/상담성 민감 질문) 가 그대로 보존되던 결함. fingerprint helper 로
`sha256:<12hex>/len=<N>` 대체.
"""

from __future__ import annotations

import re

from src.common.log_helpers import query_fingerprint


def test_fingerprint_format_matches_spec() -> None:
    """sha256 12hex prefix + len 형식."""
    fp = query_fingerprint("축복이란 무엇인가요?")
    assert re.fullmatch(r"sha256:[0-9a-f]{12}/len=\d+", fp)


def test_fingerprint_length_reflects_input_chars() -> None:
    """len 은 unicode chars (bytes 가 아님)."""
    fp_short = query_fingerprint("축복")
    fp_long = query_fingerprint("축복" * 100)
    assert fp_short.endswith("/len=2")
    assert fp_long.endswith("/len=200")


def test_fingerprint_empty_string() -> None:
    """빈 string 도 안전 — sha256 매핑 + len=0."""
    fp = query_fingerprint("")
    assert fp.endswith("/len=0")
    assert re.fullmatch(r"sha256:[0-9a-f]{12}/len=0", fp)


def test_fingerprint_deterministic() -> None:
    """동일 input → 동일 fingerprint (운영 로그에서 재발 빈도 추적용)."""
    a = query_fingerprint("같은 질문입니다.")
    b = query_fingerprint("같은 질문입니다.")
    assert a == b


def test_fingerprint_distinguishes_inputs() -> None:
    """서로 다른 input → 서로 다른 fingerprint (1자 차이 포함)."""
    a = query_fingerprint("축복이란 무엇인가요?")
    b = query_fingerprint("축복이란 무엇인가요!")
    assert a != b


def test_fingerprint_does_not_leak_pii() -> None:
    """fingerprint 안에 raw query 가 substring 으로 노출되지 X."""
    pii = "주민번호 850101-1234567"
    fp = query_fingerprint(pii)
    assert "850101" not in fp
    assert "주민" not in fp
