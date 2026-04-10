"""src/common/schemas.py 단위 테스트."""

import pytest
from pydantic import ValidationError

from src.common.schemas import ErrorResponse


def test_error_response_required_fields():
    """필수 필드(error_code, message, request_id) 없으면 ValidationError."""
    with pytest.raises(ValidationError):
        ErrorResponse()  # type: ignore[call-arg]


def test_error_response_minimal_valid():
    """필수 필드만 제공해도 정상 생성."""
    resp = ErrorResponse(
        error_code="TEST_ERROR",
        message="테스트 메시지",
        request_id="abc-123",
    )
    assert resp.error_code == "TEST_ERROR"
    assert resp.message == "테스트 메시지"
    assert resp.request_id == "abc-123"
    assert resp.details is None


def test_error_response_with_details():
    """details 필드가 optional로 동작."""
    resp = ErrorResponse(
        error_code="TEST_ERROR",
        message="테스트",
        request_id="abc-123",
        details={"tier": 0, "reason": "timeout"},
    )
    assert resp.details == {"tier": 0, "reason": "timeout"}


def test_error_response_serialization():
    """model_dump()가 JSON 직렬화 가능한 dict 반환."""
    resp = ErrorResponse(
        error_code="INPUT_BLOCKED",
        message="차단된 입력",
        request_id="req-xyz",
    )
    dumped = resp.model_dump()
    assert dumped == {
        "error_code": "INPUT_BLOCKED",
        "message": "차단된 입력",
        "request_id": "req-xyz",
        "details": None,
    }


def test_error_response_request_id_is_required():
    """request_id 누락 시 ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        ErrorResponse(  # type: ignore[call-arg]
            error_code="TEST",
            message="test",
        )
    assert "request_id" in str(exc_info.value)
