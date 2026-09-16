"""훈독 Repository — AsyncSession 은 여기만 보유한다."""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import DailyReading


class DailyReadingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_date(self, reading_date: date) -> DailyReading | None:
        result = await self.session.execute(
            select(DailyReading).where(DailyReading.reading_date == reading_date)
        )
        return result.scalar_one_or_none()

    async def create(self, reading: DailyReading) -> DailyReading:
        self.session.add(reading)
        await self.session.commit()
        await self.session.refresh(reading)
        return reading
