"""Rate Limiting FastAPI 의존성 + 공용 client IP 추출 helper."""

from fastapi import Request

from app.modules.safety.rate_limiter import RateLimiter, get_rate_limiter

# 로그인(훈독·관리자) 시도 상한. bcrypt 가 요청마다 CPU 를 쓰므로 비밀번호 대입·부하를 IP 단위로 묶는다.
# 교회 Wi-Fi 처럼 NAT 하나 뒤에서 여럿이 로그인해도 막히지 않게 30회/60초로 둔다(초대 코드 limiter 와 같은 기준).
login_limiter = RateLimiter(max_requests=30, window_seconds=60)


def extract_client_ip(request: Request) -> str:
    """Reverse proxy (Cloudflare Tunnel) 환경의 원 클라이언트 IP.

    audit 2차 C-3 (2026-05-15): 기존 `request.client.host` 만 사용해서 LB 뒤에서
    모든 요청이 동일 LB IP 로 집계되어 rate limit 이 사실상 무력화되던 결함 fix.

    Oracle 이전 (2026-07-29) 후속: 유일한 ingress 가 Cloudflare Tunnel 이므로
    `CF-Connecting-IP` 를 XFF 보다 우선한다. XFF 는 클라이언트가 임의로 붙여
    보낼 수 있고 Cloudflare 는 받은 XFF 뒤에 실제 IP 를 append 하므로, 첫 토큰만
    믿으면 공격자가 원하는 값을 심어 rate limit (20req/min/IP) 을 우회할 수 있다.
    반면 CF-Connecting-IP 는 edge 가 항상 덮어쓴다.

    우선순위: `cf-connecting-ip` → `x-forwarded-for` 첫 토큰 →
    socket peer (`request.client.host`) → "unknown".

    XFF fallback 을 남겨두는 이유는 로컬 개발과 Cloudflare 를 거치지 않는 내부
    호출 때문이다. 이 경로는 Oracle Security List 가 22 외 인바운드를 막고 있어
    외부에서 직접 도달할 수 없다.
    """
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        cf_ip = cf_ip.strip()
        if cf_ip:
            return cf_ip
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


async def check_login_rate_limit(request: Request) -> None:
    """로그인 엔드포인트 전용 IP 상한(채팅 상한과 따로 센다)."""
    login_limiter.check(extract_client_ip(request))
