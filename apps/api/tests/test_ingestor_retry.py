"""audit 2차 R-2 (2026-05-15) — _embed_batch_with_retry 3회 시도 회귀 잠금.

기존 ``max_retries=2`` 가 docstring + 로그의 "3회" 와 drift. 실제 시도는 2회 (0,1),
마지막은 fail 처리. fix: 3회 시도 (0,1,2) 로 정정. wait pattern 90→180→360초.
"""

from __future__ import annotations

import inspect

from app.modules.pipeline import ingestor


def test_max_retries_is_three() -> None:
    """``_embed_batch_with_retry`` 안 ``max_retries`` 가 3 임을 source 잠금."""
    src = inspect.getsource(ingestor._embed_batch_with_retry)
    assert "max_retries = 3" in src, "audit 2차 R-2 회귀 — max_retries 가 3 이어야 함"


def test_docstring_aligns_with_attempts() -> None:
    """docstring 의 '90→180→360' 패턴 명시 — drift 회귀 방지."""
    doc = ingestor._embed_batch_with_retry.__doc__ or ""
    assert "90→180→360" in doc, "audit 2차 R-2 — docstring 이 3회 wait 패턴 명시해야 함"


def test_retry_loop_uses_max_retries_format_string() -> None:
    """에러 로그가 hard-coded '3회' 대신 max_retries 변수 사용 (정합화).

    이전 코드: ``"Rate limit 3회 연속 실패"``. 본 fix: ``"Rate limit %d회 연속 실패"``.
    """
    src = inspect.getsource(ingestor._embed_batch_with_retry)
    # hard-coded "3회 연속 실패" 가 없어야 함 (format string 사용)
    assert "3회 연속 실패" not in src
    assert "%d회 연속 실패" in src
