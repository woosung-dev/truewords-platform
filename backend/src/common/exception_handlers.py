"""FastAPI exception handlers.

모든 사용자 정의 예외를 ErrorResponse 포맷으로 변환.
main.py에서 app.add_exception_handler로 등록.
"""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

from src.common.schemas import ErrorResponse
from src.safety.exceptions import InputBlockedError, RateLimitExceededError

logger = logging.getLogger(__name__)


def _get_request_id(request: Request) -> str:
    """request.state.request_id 안전 접근. 미들웨어 미적용 시 fallback."""
    return getattr(request.state, "request_id", "no-request-id")


async def input_blocked_handler(
    request: Request, exc: InputBlockedError
) -> JSONResponse:
    """Prompt Injection 등 악의적 입력 차단 (400)."""
    return JSONResponse(
        status_code=400,
        content=ErrorResponse(
            error_code="INPUT_BLOCKED",
            message=exc.reason,
            request_id=_get_request_id(request),
        ).model_dump(),
    )


async def rate_limit_handler(
    request: Request, exc: RateLimitExceededError
) -> JSONResponse:
    """요청 빈도 제한 초과 (429). Retry-After 헤더 보존."""
    return JSONResponse(
        status_code=429,
        content=ErrorResponse(
            error_code="RATE_LIMIT_EXCEEDED",
            message=str(exc),
            request_id=_get_request_id(request),
        ).model_dump(),
        headers={"Retry-After": str(exc.retry_after)},
    )
