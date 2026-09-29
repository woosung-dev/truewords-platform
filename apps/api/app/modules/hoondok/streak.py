"""연속일 계산 — 순수 함수. 저장하지 않고 mission_logs 의 날짜 집합에서 매번 계산한다 (API-HD-004).

기준(PLAN-HD-001 §10, 2026-09-16): 연속일·이번 주 done 은 `read`(훈독하기) 완료 기준. KST 자정 경계는
호출자가 today_kst() 로 넘긴 `today` 에 이미 반영돼 있다. "쉬어가기" 면제는 비범위.

편성 없는 날(C3 S1, 2026-09-29): `skip_dates` 에 든 날은 읽지 않았어도 연속을 끊지 않고 늘리지도 않는다.
운영 공백이 사용자 기록에 번지지 않게 하려는 것이다. 읽은 날은 편성 여부와 상관없이 센다(정성 진행자는
공식 편성이 없는 날에도 정성 말씀을 읽는다).
"""

from __future__ import annotations

from collections.abc import Set as AbstractSet
from datetime import date, timedelta

from app.modules.hoondok.schemas import SummaryResponse, TodayFlags, WeekDay


def current_streak(done_dates: set[date], today: date, skip_dates: AbstractSet[date] = frozenset()) -> int:
    """오늘 완료면 오늘부터, 아니면 어제부터 거슬러 센다 — 오늘 아직 안 읽었다고 연속이 끊기진 않는다."""
    cursor = today if today in done_dates else today - timedelta(days=1)
    streak = 0
    while cursor in done_dates or cursor in skip_dates:
        if cursor in done_dates:
            streak += 1
        cursor -= timedelta(days=1)
    return streak


def best_streak(done_dates: set[date], skip_dates: AbstractSet[date] = frozenset()) -> int:
    best = run = 0
    previous: date | None = None
    for day in sorted(done_dates):
        run = run + 1 if previous is not None and _only_skipped_between(previous, day, skip_dates) else 1
        best = max(best, run)
        previous = day
    return best


def _only_skipped_between(start: date, end: date, skip_dates: AbstractSet[date]) -> bool:
    """start 와 end 사이(양끝 제외)가 모두 편성 없는 날인가. 바로 다음 날이면 사이가 비어 True."""
    return all(start + timedelta(days=i) in skip_dates for i in range(1, (end - start).days))


def week_of(today: date, done_dates: set[date]) -> list[WeekDay]:
    """월요일 시작 7칸(홈 요일 스트립과 같은 순서)."""
    monday = today - timedelta(days=today.weekday())
    return [WeekDay(date=monday + timedelta(days=i), done=(monday + timedelta(days=i)) in done_dates) for i in range(7)]


def compute_summary(
    read_dates: set[date],
    today: date,
    today_flags: TodayFlags,
    skip_dates: AbstractSet[date] = frozenset(),
) -> SummaryResponse:
    return SummaryResponse(
        today=today_flags,
        streak_days=current_streak(read_dates, today, skip_dates),
        best_streak_days=best_streak(read_dates, skip_dates),
        total_days=len(read_dates),
        week=week_of(today, read_dates),
    )
