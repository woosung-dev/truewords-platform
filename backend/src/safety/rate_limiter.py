"""인메모리 슬라이딩 윈도우 Rate Limiter."""

import time
from collections import defaultdict, deque

from src.config import settings
from src.safety.exceptions import RateLimitExceededError


class RateLimiter:
    """IP 기반 슬라이딩 윈도우 Rate Limiter.

    단일 인스턴스 배포용. 멀티 인스턴스 시 Redis 기반으로 교체.
    """

    def __init__(
        self,
        max_requests: int | None = None,
        window_seconds: int | None = None,
    ) -> None:
        self.max_requests = max_requests or settings.rate_limit_max_requests
        self.window_seconds = window_seconds or settings.rate_limit_window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)

    def check(self, client_ip: str) -> None:
        """요청 빈도 체크. 초과 시 RateLimitExceededError 발생."""
        now = time.monotonic()
        window = self._requests[client_ip]

        # 윈도우 밖의 오래된 요청 제거
        while window and window[0] <= now - self.window_seconds:
            window.popleft()

        if len(window) >= self.max_requests:
            raise RateLimitExceededError(retry_after=self.window_seconds)

        window.append(now)

    def reset(self, client_ip: str | None = None) -> None:
        """테스트용. 특정 IP 또는 전체 초기화."""
        if client_ip:
            self._requests.pop(client_ip, None)
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
