"""인메모리 슬라이딩 윈도우 Rate Limiter."""

import ipaddress
import time
from collections import defaultdict, deque

from app.core.config import settings
from app.modules.safety.exceptions import RateLimitExceededError


class RateLimiter:
    """IP 기반 슬라이딩 윈도우 Rate Limiter.

    단일 인스턴스 배포용. 멀티 인스턴스 시 Redis 기반으로 교체.

    audit 2차 C-4 (2026-05-15): 현재 ``Dockerfile`` 가 uvicorn ``--workers=1`` 단일
    워커로 운영. multi-worker / multi-instance 로 scale 시 본 in-memory 카운터는
    worker 별 격리되어 rate limit 이 (worker 수) × max_requests 까지 허용. Cloud
    Run scale-out 시점 다음 옵션 중 선택:

    1. Redis cluster + INCR + EXPIRE 패턴 (권장 — strict)
    2. Cloud Memorystore + token bucket
    3. Cloud Armor rate limiting (infra 단)

    본 클래스의 process-local 동작을 가정한 호출자 (`safety/middleware.check_rate_limit`)
    는 그대로 유지. 교체 시 ``get_rate_limiter()`` factory 만 swap.
    """

    def __init__(
        self,
        max_requests: int | None = None,
        window_seconds: int | None = None,
    ) -> None:
        self.max_requests = max_requests or settings.rate_limit_max_requests
        self.window_seconds = window_seconds or settings.rate_limit_window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._last_sweep = time.monotonic()

    @staticmethod
    def _bucket(key: str) -> str:
        """IPv6 는 /64 단위로 묶는다 — 한 회선(/64) 안에서 주소를 바꿔 상한을 우회하지 못하게.
        IPv4·사용자 id 등 IP 가 아닌 키는 그대로 쓴다."""
        try:
            addr = ipaddress.ip_address(key)
        except ValueError:
            return key
        if addr.version == 6:
            return str(ipaddress.ip_network(f"{addr}/64", strict=False))
        return key

    def _sweep(self, now: float) -> None:
        """윈도 밖이 된 키를 지운다(창 길이마다 한 번). 키가 무한히 쌓여 메모리가 느는 것을 막는다."""
        if now - self._last_sweep < self.window_seconds:
            return
        self._last_sweep = now
        cutoff = now - self.window_seconds
        for key in [k for k, w in self._requests.items() if not w or w[-1] <= cutoff]:
            del self._requests[key]

    def check(self, client_ip: str) -> None:
        """요청 빈도 체크. 초과 시 RateLimitExceededError 발생."""
        now = time.monotonic()
        self._sweep(now)
        window = self._requests[self._bucket(client_ip)]

        # 윈도우 밖의 오래된 요청 제거
        while window and window[0] <= now - self.window_seconds:
            window.popleft()

        if len(window) >= self.max_requests:
            raise RateLimitExceededError(retry_after=self.window_seconds)

        window.append(now)

    def reset(self, client_ip: str | None = None) -> None:
        """테스트용. 특정 IP 또는 전체 초기화."""
        if client_ip:
            self._requests.pop(self._bucket(client_ip), None)
        else:
            self._requests.clear()


# 싱글턴 인스턴스
_rate_limiter: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    """Rate Limiter 싱글턴."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter
