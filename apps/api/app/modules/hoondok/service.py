"""훈독 Service — 오늘 말씀 조회 · 미션 완료 · 요약 · 월 기록 · 정성 기간(API-HD-009) · 편성 admin(API-HD-006~008)."""

import calendar
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.common.clock import today_kst
from app.modules.hoondok.jeongseong import compute_progress
from app.modules.hoondok.models import DailyReading, JeongseongPeriod, MissionLog
from app.modules.hoondok.repository import DailyReadingRepository, JeongseongRepository, MissionLogRepository
from app.modules.hoondok.schemas import (
    DailyReadingAdminCreate,
    DailyReadingAdminUpdate,
    DailyReadingPublic,
    JeongseongCreate,
    JeongseongCurrentResponse,
    JeongseongPeriodResponse,
    MissionCompleteResponse,
    MissionKind,
    MonthHistoryResponse,
    SummaryResponse,
    TodayFlags,
    TodayReadingResponse,
    WeekDay,
)
from app.modules.hoondok.streak import compute_summary

HISTORY_MIN_YEAR = 2020  # 월 기록 조회 하한. 상한은 올해 + 1
JEONGSEONG_START_WINDOW_DAYS = 30  # 시작일 허용 범위: 오늘 ~ 오늘 + 30


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class HoondokService:
    def __init__(
        self,
        repo: DailyReadingRepository,
        today_fn: Callable[[], date] = today_kst,
    ) -> None:
        self.repo = repo
        self.today_fn = today_fn

    async def get_today(self) -> TodayReadingResponse:
        """KST 오늘 편성. 없으면 none, 철회면 withdrawn (본문 미노출). 대체 콘텐츠를 만들지 않는다."""
        today = self.today_fn()
        reading = await self.repo.get_by_date(today)
        if reading is None:
            return TodayReadingResponse(date=today, status="none", reading=None)
        if reading.review_status == "withdrawn":
            return TodayReadingResponse(date=today, status="withdrawn", reading=None)
        return TodayReadingResponse(
            date=today,
            status="available",
            reading=DailyReadingPublic.model_validate(reading, from_attributes=True),
        )


class MissionService:
    """API-HD-004·005. 날짜는 서버가 정하므로 소급은 구조상 당일만 가능하다."""

    def __init__(
        self,
        repo: MissionLogRepository,
        today_fn: Callable[[], date] = today_kst,
    ) -> None:
        self.repo = repo
        self.today_fn = today_fn

    async def complete(self, user_id: uuid.UUID, kind: MissionKind) -> MissionCompleteResponse:
        log = MissionLog(user_id=user_id, mission_date=self.today_fn(), kind=kind)
        try:
            saved = await self.repo.create(log)
        except IntegrityError:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="오늘은 이미 완료했어요")
        return MissionCompleteResponse(mission_date=saved.mission_date, kind=kind, completed_at=saved.completed_at)

    async def summary(self, user_id: uuid.UUID) -> SummaryResponse:
        today = self.today_fn()
        kinds_today = await self.repo.kinds_on(user_id, today)
        read_dates = set(await self.repo.list_dates(user_id, "read"))
        flags = TodayFlags(read="read" in kinds_today, pray="pray" in kinds_today, study="study" in kinds_today)
        return compute_summary(read_dates, today, flags)

    async def history(self, user_id: uuid.UUID, month: str | None) -> MonthHistoryResponse:
        """API-HD-010 월 기록. month 는 라우터가 `YYYY-MM` 형태를 검증하고, 연도 범위는 여기서 422 로 막는다."""
        today = self.today_fn()
        month = month or f"{today:%Y-%m}"
        year, mon = int(month[:4]), int(month[5:7])
        if not HISTORY_MIN_YEAR <= year <= today.year + 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"조회 연도는 {HISTORY_MIN_YEAR}~{today.year + 1} 사이여야 해요",
            )
        read_dates = set(await self.repo.list_dates(user_id, "read"))
        _, days_in_month = calendar.monthrange(year, mon)
        days = [
            WeekDay(date=d, done=(d <= today and d in read_dates))  # 미래 날은 항상 false
            for d in (date(year, mon, i) for i in range(1, days_in_month + 1))
        ]
        return MonthHistoryResponse(month=month, days=days)


class JeongseongService:
    """API-HD-009 정성 기간. 사용자당 active 1건 — 선조회 409 + 부분 unique IntegrityError 폴백 409.

    진행률은 저장하지 않고 mission_logs 의 read 완료일에서 매번 계산한다. active 인데 end_on 을 지난 기간은
    읽는 시점에 completed 로 정리한다(별도 배치 없음).
    """

    def __init__(
        self,
        repo: JeongseongRepository,
        missions: MissionLogRepository,
        today_fn: Callable[[], date] = today_kst,
    ) -> None:
        self.repo = repo
        self.missions = missions
        self.today_fn = today_fn

    async def get_current(self, user_id: uuid.UUID) -> JeongseongCurrentResponse:
        today = self.today_fn()
        period = await self._resolve_active(user_id, today)
        if period is None:
            return JeongseongCurrentResponse(period=None)
        return JeongseongCurrentResponse(period=await self._to_response(period, today))

    async def create(self, user_id: uuid.UUID, data: JeongseongCreate) -> JeongseongPeriodResponse:
        today = self.today_fn()
        started_on = data.started_on or today
        if not today <= started_on <= today + timedelta(days=JEONGSEONG_START_WINDOW_DAYS):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"시작일은 오늘부터 {JEONGSEONG_START_WINDOW_DAYS}일 안이어야 해요",
            )
        if await self._resolve_active(user_id, today) is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 진행 중인 정성 기간이 있어요")
        period = JeongseongPeriod(
            user_id=user_id,
            topic=data.topic,
            duration_days=data.duration_days,
            started_on=started_on,
            reminder_time=data.reminder_time,
        )
        try:
            saved = await self.repo.create(period)
        except IntegrityError:
            # 동시 생성 경쟁 — 부분 unique 가 잡은 경우도 같은 409.
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 진행 중인 정성 기간이 있어요")
        return await self._to_response(saved, today)

    async def abandon(self, user_id: uuid.UUID) -> None:
        """DELETE — active 를 abandoned 로. 이미 끝난 기간은 completed 로 정리되므로 404."""
        period = await self._resolve_active(user_id, self.today_fn())
        if period is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="진행 중인 정성 기간이 없어요")
        await self._transition(period, "abandoned")

    async def _resolve_active(self, user_id: uuid.UUID, today: date) -> JeongseongPeriod | None:
        """active 기간을 돌려주되, end_on 을 지났으면 completed 로 기록하고 None."""
        period = await self.repo.get_active(user_id)
        if period is None:
            return None
        if today > period.started_on + timedelta(days=period.duration_days - 1):
            await self._transition(period, "completed")
            return None
        return period

    async def _transition(self, period: JeongseongPeriod, to_status: str) -> None:
        now = _utcnow()
        period.status = to_status
        period.ended_at = now
        period.updated_at = now
        await self.repo.save(period)

    async def _to_response(self, period: JeongseongPeriod, today: date) -> JeongseongPeriodResponse:
        read_dates = set(await self.missions.list_dates(period.user_id, "read"))
        return JeongseongPeriodResponse(
            id=period.id,
            topic=period.topic,
            duration_days=period.duration_days,
            started_on=period.started_on,
            reminder_time=period.reminder_time,
            status=period.status,
            progress=compute_progress(period.started_on, period.duration_days, read_dates, today),
        )


DEFAULT_LIST_DAYS = 14  # 기본 목록 범위: 오늘 ~ +14일
MAX_LIST_DAYS = 366


class DailyReadingAdminService:
    """편성 운영(API-HD-006~008). 비개발자 편성자가 admin 화면에서 쓴다 — 결정 2026-09-19.

    삭제는 없다. 철회는 `review_status=withdrawn` 이며 공개 API 는 그날을 `withdrawn` 으로 알린다.
    """

    def __init__(
        self,
        repo: DailyReadingRepository,
        today_fn: Callable[[], date] = today_kst,
    ) -> None:
        self.repo = repo
        self.today_fn = today_fn

    async def list(self, start: date | None, end: date | None) -> list[DailyReading]:
        start = start or self.today_fn()
        end = end or start + timedelta(days=DEFAULT_LIST_DAYS)
        if end < start:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="종료일이 시작일보다 앞섭니다")
        if (end - start).days > MAX_LIST_DAYS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"조회 범위는 최대 {MAX_LIST_DAYS}일입니다"
            )
        return await self.repo.list_range(start, end)

    async def get(self, reading_id: uuid.UUID) -> DailyReading:
        reading = await self.repo.get_by_id(reading_id)
        if reading is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="편성을 찾을 수 없습니다")
        return reading

    async def create(self, data: DailyReadingAdminCreate) -> DailyReading:
        try:
            return await self.repo.create(DailyReading(**data.model_dump()))
        except IntegrityError:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="그 날짜에는 이미 편성이 있어요")

    async def update(self, reading_id: uuid.UUID, data: DailyReadingAdminUpdate) -> DailyReading:
        reading = await self.get(reading_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(reading, field, value)
        reading.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        try:
            return await self.repo.save(reading)
        except IntegrityError:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="그 날짜에는 이미 편성이 있어요")
