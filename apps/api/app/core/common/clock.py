"""기준 시간대 헬퍼 (PLAN-HD-001 결정 9: 베타는 KST 고정).

컨테이너·cron 은 UTC 다. DB 타임스탬프는 aware UTC(timestamptz)로 저장하고,
현재 시각 생성은 `utcnow()` 한 곳을 쓴다. "오늘"·연속일 같은 날짜 판정과 표시만
KST 로 바꾸며, 날짜(date) 컬럼은 KST 날짜다.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")


def utcnow() -> datetime:
    """현재 시각(aware UTC). naive 값은 sqlmodel UTCDateTime 이 DB 바인딩에서 거부한다."""
    return datetime.now(timezone.utc)


def today_kst(now: datetime | None = None) -> date:
    """KST 기준 오늘. `now` 는 tz-aware 또는 naive UTC 를 받는다 (테스트 주입용)."""
    current = now or utcnow()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(KST).date()
