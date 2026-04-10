"""exception_handlers.py 단위 테스트 — 각 handler를 직접 호출."""

import json
from unittest.mock import Mock

import pytest
from fastapi import Request
from fastapi.responses import JSONResponse

from src.common.exception_handlers import (
    embedding_failed_handler,
    input_blocked_handler,
    rate_limit_handler,
    search_failed_handler,
    unhandled_exception_handler,
)
from src.safety.exceptions import InputBlockedError, RateLimitExceededError
from src.search.exceptions import EmbeddingFailedError, SearchFailedError


def _make_mock_request(request_id: str = "test-rid-001") -> Request:
    """핸들러 호출용 최소 Mock request (state.request_id만 가짐)."""
    req = Mock(spec=Request)
    req.state = Mock()
    req.state.request_id = request_id
    return req


def _parse_json_response(response: JSONResponse) -> dict:
    """JSONResponse body를 dict로. json.loads는 bytes-like 객체를 직접 받음."""
    return json.loads(bytes(response.body))


@pytest.mark.asyncio
async def test_input_blocked_handler_returns_400_status():
    """InputBlockedError → 400 Bad Request."""
    req = _make_mock_request()
    exc = InputBlockedError("차단된 입력입니다.")

    response = await input_blocked_handler(req, exc)

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_input_blocked_handler_returns_error_response_format():
    """응답 body가 ErrorResponse 포맷 준수."""
    req = _make_mock_request("test-rid-002")
    exc = InputBlockedError("악의적 프롬프트 감지")

    response = await input_blocked_handler(req, exc)
    body = _parse_json_response(response)

    assert body["error_code"] == "INPUT_BLOCKED"
    assert body["message"] == "악의적 프롬프트 감지"
    assert body["request_id"] == "test-rid-002"
    assert body["details"] is None


@pytest.mark.asyncio
async def test_input_blocked_handler_handles_missing_request_id():
    """request.state.request_id가 없어도 'no-request-id' fallback."""
    req = Mock(spec=Request)
    req.state = Mock(spec=[])  # state에 request_id 속성 없음
    exc = InputBlockedError()

    response = await input_blocked_handler(req, exc)
    body = _parse_json_response(response)

    assert body["request_id"] == "no-request-id"


@pytest.mark.asyncio
async def test_rate_limit_handler_returns_429_status():
    """RateLimitExceededError → 429 Too Many Requests."""
    req = _make_mock_request()
    exc = RateLimitExceededError(retry_after=60)

    response = await rate_limit_handler(req, exc)

    assert response.status_code == 429


@pytest.mark.asyncio
async def test_rate_limit_handler_preserves_retry_after_header():
    """Retry-After 헤더가 exception의 retry_after 값으로 설정됨."""
    req = _make_mock_request()
    exc = RateLimitExceededError(retry_after=120)

    response = await rate_limit_handler(req, exc)

    assert response.headers.get("Retry-After") == "120"


@pytest.mark.asyncio
async def test_rate_limit_handler_returns_error_response_format():
    """응답 body가 ErrorResponse 포맷."""
    req = _make_mock_request("test-rid-rate")
    exc = RateLimitExceededError(retry_after=60)

    response = await rate_limit_handler(req, exc)
    body = _parse_json_response(response)

    assert body["error_code"] == "RATE_LIMIT_EXCEEDED"
    assert "요청 빈도 제한" in body["message"]
    assert body["request_id"] == "test-rid-rate"


@pytest.mark.asyncio
async def test_search_failed_handler_returns_503():
    """SearchFailedError → 503."""
    req = _make_mock_request("rid-search")
    exc = SearchFailedError("All 3 tiers failed")

    response = await search_failed_handler(req, exc)

    assert response.status_code == 503
    body = _parse_json_response(response)
    assert body["error_code"] == "SEARCH_FAILED"
    assert body["request_id"] == "rid-search"


@pytest.mark.asyncio
async def test_search_failed_handler_does_not_leak_upstream_details():
    """응답 메시지에 'Qdrant'나 'tier' 같은 내부 용어가 노출되지 않음."""
    req = _make_mock_request()
    exc = SearchFailedError("Qdrant tier 2 ConnectionError")

    response = await search_failed_handler(req, exc)
    body = _parse_json_response(response)

    message_lower = body["message"].lower()
    assert "qdrant" not in message_lower
    assert "tier" not in message_lower
    assert "connection" not in message_lower
    # 대신 사용자 친화적 문구 포함
    assert "다시 시도" in body["message"] or "장애" in body["message"]


@pytest.mark.asyncio
async def test_embedding_failed_handler_returns_503():
    """EmbeddingFailedError → 503."""
    req = _make_mock_request("rid-embed")
    exc = EmbeddingFailedError("Gemini quota")

    response = await embedding_failed_handler(req, exc)

    assert response.status_code == 503
    body = _parse_json_response(response)
    assert body["error_code"] == "EMBEDDING_FAILED"
    assert body["request_id"] == "rid-embed"


@pytest.mark.asyncio
async def test_embedding_failed_handler_does_not_leak_upstream_details():
    """응답에 'Gemini' 같은 내부 프로바이더 이름 노출 안 함."""
    req = _make_mock_request()
    exc = EmbeddingFailedError("Gemini API 401 Unauthorized")

    response = await embedding_failed_handler(req, exc)
    body = _parse_json_response(response)

    message_lower = body["message"].lower()
    assert "gemini" not in message_lower
    assert "401" not in body["message"]


@pytest.mark.asyncio
async def test_unhandled_exception_handler_returns_500():
    """일반 Exception → 500."""
    req = _make_mock_request("rid-unhandled")
    exc = KeyError("some_missing_key")

    response = await unhandled_exception_handler(req, exc)

    assert response.status_code == 500
    body = _parse_json_response(response)
    assert body["error_code"] == "INTERNAL_ERROR"
    assert body["request_id"] == "rid-unhandled"


@pytest.mark.asyncio
async def test_unhandled_exception_handler_generic_message():
    """응답 메시지가 generic (예외 타입/상세 노출 안 함)."""
    req = _make_mock_request()
    exc = KeyError("secret_internal_key")

    response = await unhandled_exception_handler(req, exc)
    body = _parse_json_response(response)

    assert "secret_internal_key" not in body["message"]
    assert "KeyError" not in body["message"]
    assert body["message"] == "서버 내부 오류가 발생했습니다."


@pytest.mark.asyncio
async def test_unhandled_exception_handler_logs_details(caplog):
    """예외 stacktrace가 로그에 남는다."""
    import logging
    req = _make_mock_request("rid-log-test")
    exc = ValueError("internal debug info that must be logged")

    with caplog.at_level(logging.ERROR):
        await unhandled_exception_handler(req, exc)

    # logger.exception이 호출되어 에러 레벨 로그가 기록됨
    assert any("Unhandled exception" in rec.message for rec in caplog.records)
