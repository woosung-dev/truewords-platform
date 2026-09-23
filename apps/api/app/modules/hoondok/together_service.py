"""훈독 "함께 읽는 사람들" 1단계 — 익명 숫자 (PLAN-HD-009, API-HD-029).

오늘(KST) 훈독하기(`read`, 연속일과 같은 kind)를 마친 서로 다른 사용자 수만 센다. 모임·가족·개인 정보는 없다.
threshold 미만이면 숫자를 응답에 싣지 않는다. 홈이 조회할 때마다 집계하지 않도록 날짜별 원시 수를
프로세스 메모리에 짧게(기본 60초) 둔다 — 워커마다 따로 갖는 캐시라 워커 간 값이 잠시 다를 수 있다.
"""

import time
from collections.abc import Callable
from datetime import date

from app.core.common.clock import today_kst
from app.modules.hoondok.repository import MissionLogRepository
from app.modules.hoondok.schemas import TogetherTodayResponse

TOGETHER_KIND = "read"  # 훈독하기. 연속일(streak) 계산과 같은 kind

# 날짜 → (만료 monotonic 시각, 원시 완료자 수). 날짜가 키라 KST 자정이 지나면 자연히 새 키로 넘어간다.
_CACHE: dict[date, tuple[float, int]] = {}


def clear_together_cache() -> None:
    """테스트 격리용."""
    _CACHE.clear()


class TogetherService:
    def __init__(
        self,
        repo: MissionLogRepository,
        *,
        min_count: int,
        cache_seconds: float,
        today_fn: Callable[[], date] = today_kst,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.repo = repo
        self.min_count = min_count
        self.cache_seconds = cache_seconds
        self.today_fn = today_fn
        self.clock = clock

    async def get_today(self) -> TogetherTodayResponse:
        today = self.today_fn()
        count = await self._count(today)
        is_shown = count >= self.min_count
        return TogetherTodayResponse(
            date=today,
            count=count if is_shown else None,
            is_shown=is_shown,
            threshold=self.min_count,
        )

    async def _count(self, today: date) -> int:
        if self.cache_seconds <= 0:
            return await self.repo.count_users_on(today, TOGETHER_KIND)
        now = self.clock()
        cached = _CACHE.get(today)
        if cached and cached[0] > now:
            return cached[1]
        count = await self.repo.count_users_on(today, TOGETHER_KIND)
        # 지난 날짜 키는 남겨 둘 이유가 없다 — 오늘 키 하나만 유지한다.
        _CACHE.clear()
        _CACHE[today] = (now + self.cache_seconds, count)
        return count
