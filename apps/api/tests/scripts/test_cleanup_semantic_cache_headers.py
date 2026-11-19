"""semantic_cache 정리 스크립트의 요청 헤더 단위 테스트.

GHA 는 vdb.<zone> 을 거치는데 그 앞에 Cloudflare Access(서비스 토큰)가 있다.
헤더가 빠지면 매일 03:00 정리가 403 으로 실패하므로 조립 규칙을 여기서 잠근다.
"""
from __future__ import annotations

from scripts.cleanup_semantic_cache import _headers


def test_access_headers_added_when_both_values_present() -> None:
    headers = _headers("qk", "cid", "csecret")
    assert headers["api-key"] == "qk"
    assert headers["CF-Access-Client-Id"] == "cid"
    assert headers["CF-Access-Client-Secret"] == "csecret"


def test_no_access_headers_for_internal_url() -> None:
    headers = _headers("qk")
    assert "CF-Access-Client-Id" not in headers
    assert "CF-Access-Client-Secret" not in headers


def test_partial_access_values_are_not_sent() -> None:
    assert "CF-Access-Client-Id" not in _headers("qk", "cid", "")
    assert "CF-Access-Client-Secret" not in _headers("qk", "", "csecret")
