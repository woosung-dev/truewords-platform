"""AI 낭독 DB 접근 (PLAN-HD-011) — 월 사용량 기록·합계와 오늘 훈독 본문 조회."""

import uuid

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import DailyReading, JeongseongPeriod, JeongseongReading, TtsUsage


class TtsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def month_chars(self, month: str) -> int:
        result = await self.session.execute(select(func.coalesce(func.sum(TtsUsage.chars), 0)).where(TtsUsage.month == month))
        return int(result.scalar_one())

    async def add_usage(self, usage: TtsUsage) -> None:
        self.session.add(usage)
        await self.session.commit()

    async def get_daily_reading(self, reading_id: uuid.UUID) -> DailyReading | None:
        return await self.session.get(DailyReading, reading_id)

    async def get_jeongseong_reading(self, reading_id: uuid.UUID) -> tuple[JeongseongReading, uuid.UUID] | None:
        """정성 말씀 스냅샷과 그 기간의 소유자 id. 소유 확인은 서비스가 한다."""
        result = await self.session.execute(
            select(JeongseongReading, JeongseongPeriod.user_id)
            .join(JeongseongPeriod, JeongseongPeriod.id == JeongseongReading.period_id)
            .where(JeongseongReading.id == reading_id)
        )
        row = result.first()
        return (row[0], row[1]) if row else None
