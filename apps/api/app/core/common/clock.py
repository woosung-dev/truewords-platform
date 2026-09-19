"""기준 시간대 헬퍼 (PLAN-HD-001 결정 9: 베타는 KST 고정).

컨테이너·cron 은 UTC 다. "오늘"·연속일 판정은 여기서만 KST 로 바꾼다.
DB 타임스탬프는 기존 규약대로 naive UTC 를 유지하고, 날짜(date) 컬럼만 KST 다.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")


def today_kst(now: datetime | None = None) -> date:
    """KST 기준 오늘. `now` 는 tz-aware 또는 naive UTC 를 받는다 (테스트 주입용)."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(KST).date()
