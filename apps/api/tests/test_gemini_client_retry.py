"""audit 2차 R-1 (2026-05-15) — Gemini chat HttpRetryOptions 명시 회귀 잠금.

기존 ``retry_429=True`` 분기는 ``http_options=None`` 으로 SDK 기본값 의존 →
429/408/5xx/timeout 보장 범위가 코드에서 추적 불가. 본 fix 후 chat 클라이언트도
명시적 retry status code 가 코드 truth 가 된다. SDK upgrade 시 silent regression
차단.
"""

from __future__ import annotations

from google.genai import types

from app.core.common.gemini_client import (
    _build_chat_http_options,
    _build_restricted_http_options,
)


def test_chat_options_include_429() -> None:
    """chat 분기는 429 포함."""
    opts = _build_chat_http_options()
    assert opts.retry_options is not None
    assert 429 in opts.retry_options.http_status_codes


def test_chat_options_include_all_5xx() -> None:
    """500/502/503/504 (모든 5xx transient) 포함."""
    opts = _build_chat_http_options()
    assert opts.retry_options is not None
    for code in (500, 502, 503, 504):
        assert code in opts.retry_options.http_status_codes


def test_chat_options_include_408_request_timeout() -> None:
    """408 (request timeout) 도 포함 — GFE / Cloud Run 일시 흔들림."""
    opts = _build_chat_http_options()
    assert opts.retry_options is not None
    assert 408 in opts.retry_options.http_status_codes


def test_chat_options_attempts_3() -> None:
    """3회 시도 (초기 + 2회 재시도)."""
    opts = _build_chat_http_options()
    assert opts.retry_options is not None
    assert opts.retry_options.attempts == 3


def test_restricted_options_exclude_429() -> None:
    """embedder 분기 (retry_429=False) 는 429 의도적 제외 — 회귀 잠금."""
    opts = _build_restricted_http_options()
    assert opts.retry_options is not None
    assert 429 not in opts.retry_options.http_status_codes


def test_chat_options_is_http_options_instance() -> None:
    """반환 타입 검증 — SDK 가 요구하는 HttpOptions."""
    opts = _build_chat_http_options()
    assert isinstance(opts, types.HttpOptions)
