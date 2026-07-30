"""audit 2차 C-3 (2026-05-15): X-Forwarded-For 파싱 helper 회귀 잠금.

Cloud Run / Vercel 등 reverse proxy 환경에서 모든 요청이 LB IP 로 집계되어
IP-기반 rate limiter 가 무력화되던 결함 fix. `extract_client_ip` 가 XFF 첫 토큰
우선 사용. 기존 `request.client.host` 만 의존 시 회귀.
"""

from __future__ import annotations

from unittest.mock import Mock

import pytest

from src.safety.middleware import extract_client_ip


def _make_request(headers: dict[str, str] | None = None, client_host: str | None = None) -> Mock:
    request = Mock()
    request.headers = headers or {}
    request.client = Mock(host=client_host) if client_host else None
    return request


def test_xff_first_token_when_header_present():
    """XFF 헤더가 있으면 첫 번째 토큰 (원 클라이언트) 사용."""
    request = _make_request(
        headers={"x-forwarded-for": "203.0.113.5, 10.0.0.1, 192.168.0.1"},
        client_host="10.0.0.1",
    )
    assert extract_client_ip(request) == "203.0.113.5"


def test_xff_single_value_when_no_chain():
    """XFF 가 단일 값일 때 그대로 사용."""
    request = _make_request(
        headers={"x-forwarded-for": "198.51.100.42"},
        client_host="10.0.0.1",
    )
    assert extract_client_ip(request) == "198.51.100.42"


def test_xff_strips_whitespace():
    """XFF 앞뒤 공백 정규화."""
    request = _make_request(
        headers={"x-forwarded-for": "  203.0.113.5  ,10.0.0.1"},
        client_host="10.0.0.1",
    )
    assert extract_client_ip(request) == "203.0.113.5"


def test_fallback_to_socket_peer_when_xff_absent():
    """XFF 헤더 없으면 socket peer (request.client.host) fallback."""
    request = _make_request(headers={}, client_host="10.0.0.1")
    assert extract_client_ip(request) == "10.0.0.1"


def test_fallback_when_xff_empty_string():
    """XFF 가 빈 문자열이면 socket peer fallback."""
    request = _make_request(
        headers={"x-forwarded-for": ""},
        client_host="10.0.0.1",
    )
    assert extract_client_ip(request) == "10.0.0.1"


def test_fallback_when_xff_first_token_is_whitespace():
    """XFF 첫 토큰이 공백만이면 socket peer fallback."""
    request = _make_request(
        headers={"x-forwarded-for": "  , 10.0.0.1"},
        client_host="172.16.0.1",
    )
    assert extract_client_ip(request) == "172.16.0.1"


def test_unknown_when_no_xff_no_socket():
    """XFF 없고 socket peer 도 없으면 'unknown'."""
    request = _make_request(headers={}, client_host=None)
    assert extract_client_ip(request) == "unknown"


# --- Oracle 이전 (2026-07-29) 후속: Cloudflare Tunnel XFF 하드닝 -------------
# 유일한 ingress 가 Cloudflare Tunnel 이므로 edge 가 항상 덮어쓰는
# CF-Connecting-IP 를, 클라이언트가 위조할 수 있는 XFF 보다 우선한다.


def test_cf_connecting_ip_wins_over_forged_xff():
    """공격자가 XFF 를 심어도 CF-Connecting-IP 가 이긴다 (rate limit 우회 차단)."""
    request = _make_request(
        headers={
            "cf-connecting-ip": "203.0.113.7",
            # 공격자가 매 요청 다른 값을 넣어 IP 버킷을 흩뿌리려는 시나리오
            "x-forwarded-for": "1.2.3.4, 203.0.113.7",
        },
        client_host="172.18.0.5",
    )
    assert extract_client_ip(request) == "203.0.113.7"


def test_cf_connecting_ip_strips_whitespace():
    """CF-Connecting-IP 앞뒤 공백 정규화."""
    request = _make_request(
        headers={"cf-connecting-ip": "  203.0.113.8  "},
        client_host="172.18.0.5",
    )
    assert extract_client_ip(request) == "203.0.113.8"


def test_falls_back_to_xff_when_cf_header_absent():
    """Cloudflare 를 거치지 않는 내부 호출은 기존 XFF 동작 유지 (회귀 잠금)."""
    request = _make_request(
        headers={"x-forwarded-for": "198.51.100.9, 10.0.0.1"},
        client_host="10.0.0.1",
    )
    assert extract_client_ip(request) == "198.51.100.9"


def test_falls_back_to_xff_when_cf_header_blank():
    """CF-Connecting-IP 가 공백뿐이면 XFF 로 fallback."""
    request = _make_request(
        headers={"cf-connecting-ip": "   ", "x-forwarded-for": "198.51.100.10"},
        client_host="10.0.0.1",
    )
    assert extract_client_ip(request) == "198.51.100.10"


def test_falls_back_to_socket_peer_when_only_cf_blank():
    """CF-Connecting-IP 가 공백이고 XFF 도 없으면 socket peer."""
    request = _make_request(headers={"cf-connecting-ip": ""}, client_host="10.0.0.1")
    assert extract_client_ip(request) == "10.0.0.1"


def test_check_rate_limit_uses_xff(monkeypatch):
    """check_rate_limit dependency 가 extract_client_ip 결과를 limiter 키로 사용."""
    from src.safety import middleware as middleware_mod

    captured: dict[str, str] = {}

    class FakeLimiter:
        def check(self, ip: str) -> None:
            captured["ip"] = ip

    monkeypatch.setattr(middleware_mod, "get_rate_limiter", lambda: FakeLimiter())

    request = _make_request(
        headers={"x-forwarded-for": "203.0.113.99, 10.0.0.1"},
        client_host="10.0.0.1",
    )
    import asyncio

    asyncio.get_event_loop().run_until_complete(middleware_mod.check_rate_limit(request))
    assert captured["ip"] == "203.0.113.99"


@pytest.mark.asyncio
async def test_reactions_router_uses_shared_helper():
    """reactions_router 가 자체 _client_ip 대신 safety.middleware.extract_client_ip 사용.

    audit 2차 C-3 — XFF 파싱 로직이 두 곳에 흩어져 있으면 다음 보안 fix 때 한
    곳만 갱신될 위험. 단일 진입점 잠금.
    """
    from src.chat import reactions_router as rr_mod

    # alias `_client_ip` 가 safety.middleware.extract_client_ip 와 동일 객체여야 함
    assert rr_mod._client_ip is extract_client_ip
