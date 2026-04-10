"""FastAPI/Starlette 미들웨어."""

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp


class RequestIdMiddleware(BaseHTTPMiddleware):
    """모든 요청에 고유 request_id를 할당.

    동작:
    1. X-Request-Id 헤더가 있으면 그 값을 사용 (분산 추적 호환)
    2. 없으면 UUID v4를 새로 생성
    3. request.state.request_id에 저장 (exception_handler에서 접근 가능)
    4. 응답 헤더에도 X-Request-Id로 포함 (클라이언트가 로그 correlation 가능)
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        rid = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        return response
