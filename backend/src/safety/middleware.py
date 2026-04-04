"""Rate Limiting FastAPI 의존성."""

from fastapi import Request

from src.safety.rate_limiter import get_rate_limiter


async def check_rate_limit(request: Request) -> None:
    """FastAPI Depends로 사용. IP 기반 요청 빈도 제한."""
    client_ip = request.client.host if request.client else "unknown"
    limiter = get_rate_limiter()
    limiter.check(client_ip)
