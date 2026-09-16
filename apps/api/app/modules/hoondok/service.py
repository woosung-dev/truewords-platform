"""훈독 Service — 오늘 말씀 조회."""

from collections.abc import Callable
from datetime import date

from app.core.common.clock import today_kst
from app.modules.hoondok.repository import DailyReadingRepository
from app.modules.hoondok.schemas import DailyReadingPublic, TodayReadingResponse


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
