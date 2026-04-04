"""Rate Limiter 테스트 — 슬라이딩 윈도우, 제한 초과, 윈도우 만료."""

import time

import pytest

from src.safety.exceptions import RateLimitExceededError
from src.safety.rate_limiter import RateLimiter


class TestRateLimiter:
    """인메모리 슬라이딩 윈도우 Rate Limiter 테스트."""

    def test_allows_requests_under_limit(self) -> None:
        limiter = RateLimiter(max_requests=5, window_seconds=60)
        for _ in range(5):
            limiter.check("192.168.1.1")

    def test_blocks_requests_over_limit(self) -> None:
        limiter = RateLimiter(max_requests=3, window_seconds=60)
        for _ in range(3):
            limiter.check("192.168.1.1")
        with pytest.raises(RateLimitExceededError):
            limiter.check("192.168.1.1")

    def test_different_ips_independent(self) -> None:
        limiter = RateLimiter(max_requests=2, window_seconds=60)
        limiter.check("192.168.1.1")
        limiter.check("192.168.1.1")
        # 다른 IP는 별도 카운트
        limiter.check("192.168.1.2")
        limiter.check("192.168.1.2")
        # 원래 IP는 여전히 제한
        with pytest.raises(RateLimitExceededError):
            limiter.check("192.168.1.1")

    def test_window_sliding_expires_old_requests(self) -> None:
        limiter = RateLimiter(max_requests=2, window_seconds=1)
        limiter.check("10.0.0.1")
        limiter.check("10.0.0.1")
        # 제한 도달
        with pytest.raises(RateLimitExceededError):
            limiter.check("10.0.0.1")
        # 윈도우 만료 대기
        time.sleep(1.1)
        # 다시 허용
        limiter.check("10.0.0.1")

    def test_retry_after_value(self) -> None:
        limiter = RateLimiter(max_requests=1, window_seconds=30)
        limiter.check("10.0.0.1")
        with pytest.raises(RateLimitExceededError) as exc_info:
            limiter.check("10.0.0.1")
        assert exc_info.value.retry_after == 30

    def test_reset_specific_ip(self) -> None:
        limiter = RateLimiter(max_requests=1, window_seconds=60)
        limiter.check("10.0.0.1")
        with pytest.raises(RateLimitExceededError):
            limiter.check("10.0.0.1")
        limiter.reset("10.0.0.1")
        limiter.check("10.0.0.1")

    def test_reset_all(self) -> None:
        limiter = RateLimiter(max_requests=1, window_seconds=60)
        limiter.check("10.0.0.1")
        limiter.check("10.0.0.2")
        limiter.reset()
        limiter.check("10.0.0.1")
        limiter.check("10.0.0.2")
