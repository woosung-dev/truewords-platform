"""FastAPI/Starlette 미들웨어."""

import logging
import re
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


# 쿼리를 통째로 지우는 경로: 검색어(개인 관심사)와 push endpoint(기기 식별 capability URL — 소유 이전 upsert 와
# 결합하면 남의 구독을 가져갈 수 있다).
_QUERY_STRIPPED_PATHS = frozenset({"/hoondok/search", "/hoondok/me/push"})
# 경로에 제공자 키가 들어가는 OAuth 콜백 — 쿼리의 code·state 가 접근 로그에 남지 않게 한다.
_QUERY_STRIPPED_PATTERNS = (re.compile(r"^/hoondok/auth/oauth/[^/]+/callback$"),)


def _strips_query(path: str) -> bool:
    return path in _QUERY_STRIPPED_PATHS or any(p.match(path) for p in _QUERY_STRIPPED_PATTERNS)


class HoondokAccessLogFilter(logging.Filter):
    """Uvicorn 요청줄에서 훈독 검색어·push endpoint 쿼리를 제거한다. 응답 실패에도 동일하게 적용한다."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) == 5:
            args = list(record.args)
            target = str(args[2])
            if _strips_query(target.split("?", 1)[0].rstrip("/")):
                args[2] = target.split("?", 1)[0]
                record.args = tuple(args)
        return True
