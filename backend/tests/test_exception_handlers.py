"""exception_handlers.py 단위 테스트 — 각 handler를 직접 호출."""

import json
from unittest.mock import Mock

import pytest
from fastapi import Request
from fastapi.responses import JSONResponse

from src.common.exception_handlers import input_blocked_handler
from src.safety.exceptions import InputBlockedError


def _make_mock_request(request_id: str = "test-rid-001") -> Request:
    """핸들러 호출용 최소 Mock request (state.request_id만 가짐)."""
    req = Mock(spec=Request)
    req.state = Mock()
    req.state.request_id = request_id
    return req


def _parse_json_response(response: JSONResponse) -> dict:
    """JSONResponse body를 dict로."""
    return json.loads(response.body.decode("utf-8"))


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
