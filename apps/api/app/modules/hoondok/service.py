"""훈독 Service — 오늘 말씀 조회 · 미션 완료 · 요약 · 편성 admin(API-HD-006~008)."""

import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.common.clock import today_kst
from app.modules.hoondok.models import DailyReading, MissionLog
from app.modules.hoondok.repository import DailyReadingRepository, MissionLogRepository
from app.modules.hoondok.schemas import (
    DailyReadingAdminCreate,
    DailyReadingAdminUpdate,
    DailyReadingPublic,
    MissionCompleteResponse,
    MissionKind,
    SummaryResponse,
    TodayFlags,
    TodayReadingResponse,
)
from app.modules.hoondok.streak import compute_summary


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
