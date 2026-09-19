"""연속일 계산 — 순수 함수. 저장하지 않고 mission_logs 의 날짜 집합에서 매번 계산한다 (API-HD-004).

기준(PLAN-HD-001 §10, 2026-09-16): 연속일·이번 주 done 은 `read`(훈독하기) 완료 기준. KST 자정 경계는
호출자가 today_kst() 로 넘긴 `today` 에 이미 반영돼 있다. "쉬어가기" 면제는 비범위.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.modules.hoondok.schemas import SummaryResponse, TodayFlags, WeekDay


def current_streak(done_dates: set[date], today: date) -> int:
    """오늘 완료면 오늘부터, 아니면 어제부터 거슬러 센다 — 오늘 아직 안 읽었다고 연속이 끊기진 않는다."""
    cursor = today if today in done_dates else today - timedelta(days=1)
    streak = 0
    while cursor in done_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def best_streak(done_dates: set[date]) -> int:
    best = run = 0
    previous: date | None = None
    for day in sorted(done_dates):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    return best


def week_of(today: date, done_dates: set[date]) -> list[WeekDay]:
    """월요일 시작 7칸(홈 요일 스트립과 같은 순서)."""
    monday = today - timedelta(days=today.weekday())
    return [WeekDay(date=monday + timedelta(days=i), done=(monday + timedelta(days=i)) in done_dates) for i in range(7)]


def compute_summary(read_dates: set[date], today: date, today_flags: TodayFlags) -> SummaryResponse:
    return SummaryResponse(
        today=today_flags,
        streak_days=current_streak(read_dates, today),
        best_streak_days=best_streak(read_dates),
        total_days=len(read_dates),
        week=week_of(today, read_dates),
    )
