"""AI 낭독 DB 접근 (PLAN-HD-011) — 사용량 예약·정산·합계와 오늘 훈독 본문 조회."""

import uuid
from datetime import datetime

from sqlalchemy import delete, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import DailyReading, JeongseongPeriod, JeongseongReading, TtsUsage


class TtsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def month_chars(self, month: str) -> int:
        result = await self.session.execute(select(func.coalesce(func.sum(TtsUsage.chars), 0)).where(TtsUsage.month == month))
        return int(result.scalar_one())

    async def user_chars_since(self, user_id: uuid.UUID, since: datetime) -> int:
        result = await self.session.execute(
            select(func.coalesce(func.sum(TtsUsage.chars), 0)).where(
                TtsUsage.user_id == user_id, TtsUsage.created_at >= since
            )
        )
        return int(result.scalar_one())

    async def add_usage(self, usage: TtsUsage) -> None:
        self.session.add(usage)
        await self.session.commit()

    async def settle_usage(self, usage_id: uuid.UUID, chars: int) -> None:
        """예약한 글자 수를 실제 과금 가능 글자 수로 바꾼다. 0 이면 지운다."""
        if chars <= 0:
            await self.session.execute(delete(TtsUsage).where(TtsUsage.id == usage_id))
        else:
            await self.session.execute(update(TtsUsage).where(TtsUsage.id == usage_id).values(chars=chars))
        await self.session.commit()

    async def release(self) -> None:
        """읽기만 한 트랜잭션을 끝내 커넥션을 풀에 돌려준다 — Google 호출 동안 커넥션을 쥐고 있지 않게."""
        await self.session.commit()

    async def get_daily_reading(self, reading_id: uuid.UUID) -> DailyReading | None:
        return await self.session.get(DailyReading, reading_id)

    async def get_jeongseong_reading(
        self, reading_id: uuid.UUID
    ) -> tuple[JeongseongReading, JeongseongPeriod] | None:
        """정성 말씀 스냅샷과 그 기간. 소유·활성 확인은 서비스가 한다."""
        result = await self.session.execute(
            select(JeongseongReading, JeongseongPeriod)
            .join(JeongseongPeriod, JeongseongPeriod.id == JeongseongReading.period_id)
            .where(JeongseongReading.id == reading_id)
        )
        row = result.first()
        return (row[0], row[1]) if row else None
