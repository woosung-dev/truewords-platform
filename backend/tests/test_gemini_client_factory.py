"""Gemini 클라이언트 팩토리 단위 테스트 (§13.1 S1).

실제 genai.Client 생성은 API key 만 있으면 성공 — 네트워크 호출 없음.
"""

from __future__ import annotations

import pytest

from src.common import gemini_client


@pytest.fixture(autouse=True)
def _clear_cache():
    gemini_client.clear_cache()
    yield
    gemini_client.clear_cache()


class TestFactory:
    def test_default_creates_client(self):
        client = gemini_client.get_client()
        assert client is not None

    def test_restricted_mode_creates_client(self):
        client = gemini_client.get_client(retry_429=False)
        assert client is not None

    def test_same_flag_returns_cached_instance(self):
        a = gemini_client.get_client()
        b = gemini_client.get_client()
        assert a is b

    def test_different_flags_return_different_instances(self):
        a = gemini_client.get_client(retry_429=True)
        b = gemini_client.get_client(retry_429=False)
        assert a is not b

    def test_cache_cleared_creates_new_instance(self):
        a = gemini_client.get_client()
        gemini_client.clear_cache()
        b = gemini_client.get_client()
        assert a is not b


class TestRestrictedHttpOptions:
    """실측(dev-log 25) 기준 HttpRetryOptions 필드명/값 검증."""

    def test_retry_options_fields(self):
        options = gemini_client._build_restricted_http_options()
        retry = options.retry_options
        assert retry is not None
        assert retry.attempts == 3
        assert retry.initial_delay == 1.0
        assert retry.max_delay == 10.0
        assert retry.http_status_codes == [408, 500, 502, 503, 504]

    def test_429_is_excluded(self):
        """핵심: 429 가 retry 대상에 **없어야** ingestor.py 와의 이중 retry 를 피함."""
        options = gemini_client._build_restricted_http_options()
        assert 429 not in (options.retry_options.http_status_codes or [])
