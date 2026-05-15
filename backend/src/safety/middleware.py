"""Rate Limiting FastAPI 의존성 + 공용 client IP 추출 helper."""

from fastapi import Request

from src.safety.rate_limiter import get_rate_limiter


def extract_client_ip(request: Request) -> str:
    """Reverse proxy (Cloud Run / Vercel / Cloudflare) 환경의 원 클라이언트 IP.

    audit 2차 C-3 (2026-05-15): 기존 `request.client.host` 만 사용해서 Cloud Run
    LB 뒤에서 모든 요청이 동일 LB IP 로 집계되어 rate limit 이 사실상 무력화되던
    결함 fix. X-Forwarded-For 첫 토큰 (원 클라이언트) 을 우선 사용한다.

    Header 가 없거나 빈 값이면 socket peer (`request.client.host`) 로 fallback.
    socket peer 도 없으면 "unknown" 반환.

    XFF 신뢰는 GCP Cloud Run / Vercel 등 신뢰할 수 있는 reverse proxy 환경 가정.
    클라이언트가 직접 XFF 헤더를 위조해 보낼 수 있는 환경 (예: 직접 노출된
    Uvicorn) 에서는 운영 인프라 단에서 헤더 stripping 필요.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",", 1)[0].strip()
        if first:
            return first
    if request.client is not None:
        return request.client.host
    return "unknown"


async def check_rate_limit(request: Request) -> None:
    """FastAPI Depends로 사용. IP 기반 요청 빈도 제한."""
    client_ip = extract_client_ip(request)
    limiter = get_rate_limiter()
    limiter.check(client_ip)
