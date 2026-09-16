"""훈독 Service — 오늘 말씀 조회 · 미션 완료 · 요약."""

import uuid
from collections.abc import Callable
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.common.clock import today_kst
from app.modules.hoondok.models import MissionLog
from app.modules.hoondok.repository import DailyReadingRepository, MissionLogRepository
from app.modules.hoondok.schemas import (
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
