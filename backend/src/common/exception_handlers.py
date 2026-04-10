"""FastAPI exception handlers.

모든 사용자 정의 예외를 ErrorResponse 포맷으로 변환.
main.py에서 app.add_exception_handler로 등록.
"""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

from src.common.schemas import ErrorResponse
from src.safety.exceptions import InputBlockedError, RateLimitExceededError
from src.search.exceptions import EmbeddingFailedError, SearchFailedError

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


async def search_failed_handler(
    request: Request, exc: SearchFailedError
) -> JSONResponse:
    """모든 검색 tier 실패 (Qdrant 전체 장애 등) → 503.

    사용자 응답에는 upstream 상세 정보 노출 안 함.
    상세는 로그에만 기록.
    """
    rid = _get_request_id(request)
    logger.error(
        "SearchFailedError",
        extra={"request_id": rid, "reason": str(exc)},
    )
    return JSONResponse(
        status_code=503,
        content=ErrorResponse(
            error_code="SEARCH_FAILED",
            message="검색 서비스에 일시적 장애가 발생했습니다. 잠시 후 다시 시도해주세요.",
            request_id=rid,
        ).model_dump(),
    )


async def embedding_failed_handler(
    request: Request, exc: EmbeddingFailedError
) -> JSONResponse:
    """Gemini 임베딩 생성 실패 → 503.

    'SearchFailedError'와 구분된 에러 코드로 반환 (사용자 경험 분리).
    """
    rid = _get_request_id(request)
    logger.error(
        "EmbeddingFailedError",
        extra={"request_id": rid, "reason": str(exc)},
    )
    return JSONResponse(
        status_code=503,
        content=ErrorResponse(
            error_code="EMBEDDING_FAILED",
            message="검색 준비 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
            request_id=rid,
        ).model_dump(),
    )
