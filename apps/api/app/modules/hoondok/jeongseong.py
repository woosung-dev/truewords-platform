"""정성 기간 진행률 계산 — 순수 함수. 저장하지 않고 mission_logs 의 read 완료일 집합에서 매번 계산한다 (API-HD-009).

기간은 [started_on, end_on] 양끝 포함이며 end_on = started_on + (duration_days - 1). KST 자정 경계는 호출자가
today_kst() 로 넘긴 `today` 에 이미 반영돼 있다. **오늘은 아직 밀린 날이 아니다** — missed 는 어제까지만 센다.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.modules.hoondok.schemas import JeongseongProgress, JeongseongState


def _date_range(start: date, end: date) -> list[date]:
    """[start, end] 양끝 포함. end < start 면 빈 목록."""
    if end < start:
        return []
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def period_end(started_on: date, duration_days: int) -> date:
    return started_on + timedelta(days=duration_days - 1)


def compute_progress(started_on: date, duration_days: int, read_dates: set[date], today: date) -> JeongseongProgress:
    end_on = period_end(started_on, duration_days)
    state: JeongseongState
    if today < started_on:
        state = "upcoming"
    elif today > end_on:
        state = "completed"
    else:
        state = "active"

    # done 은 오늘까지, missed 는 어제까지 — 둘 다 end_on 을 넘지 않는다.
    done_days = sum(1 for d in _date_range(started_on, min(today, end_on)) if d in read_dates)
    missed_days = sum(1 for d in _date_range(started_on, min(today - timedelta(days=1), end_on)) if d not in read_dates)
    remaining_days = max((end_on - today).days, 0)
    # 정수 반올림(half-up). 내장 round() 는 2.5 → 2 같은 은행가 반올림이라 40일 기간의 홀수 일차가 들쭉날쭉해진다.
    percent = (done_days * 200 + duration_days) // (2 * duration_days)
    return JeongseongProgress(
        end_on=end_on,
        done_days=done_days,
        missed_days=missed_days,
        remaining_days=remaining_days,
        percent=percent,
        state=state,
    )
