"""권리와 정성 원문 저장소. DB 접근과 동시 생성 제약을 한곳에 둔다."""

import uuid
from datetime import date

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.identity.models import User

from app.modules.hoondok.models import (
    ClientErrorEvent,
    ContentRight,
    JeongseongPeriod,
    JeongseongReading,
)


class JourneyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_rights(self) -> list[ContentRight]:
        result = await self.session.execute(
            select(ContentRight)
            .order_by(ContentRight.volume)
            .execution_options(populate_existing=True)
        )
        return list(result.scalars().all())

    async def get_right(self, right_id: uuid.UUID) -> ContentRight | None:
        return await self.session.get(ContentRight, right_id)

    async def save_right(self, right: ContentRight) -> ContentRight:
        self.session.add(right)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(right)
        return right

    async def list_readings(self, period_id: uuid.UUID) -> list[JeongseongReading]:
        result = await self.session.execute(
            select(JeongseongReading).where(JeongseongReading.period_id == period_id)
        )
        return list(result.scalars().all())

    async def get_reading(
        self, period_id: uuid.UUID, reading_date: date
    ) -> JeongseongReading | None:
        result = await self.session.execute(
            select(JeongseongReading).where(
                JeongseongReading.period_id == period_id,
                JeongseongReading.reading_date == reading_date,
            )
        )
        return result.scalar_one_or_none()

    async def lock_active_period(self, period_id: uuid.UUID) -> bool:
        """검색 후 저장 직전 획득. 잠금은 같은 세션의 저장 커밋까지 유지한다."""
        result = await self.session.execute(
            select(JeongseongPeriod)
            .where(JeongseongPeriod.id == period_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        period = result.scalar_one_or_none()
        return period is not None and period.status == "active"

    async def release(self) -> None:
        await self.session.rollback()

    async def save_reading(
        self, reading: JeongseongReading
    ) -> JeongseongReading | None:
        period_id, reading_date = reading.period_id, reading.reading_date
        # 삭제·중단과 경쟁할 때 부모 행을 잠그고 다시 판정한다.
        if not await self.lock_active_period(period_id):
            await self.session.rollback()
            return None
        self.session.add(reading)
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            winner = await self.get_reading(period_id, reading_date)
            if winner is None:
                raise
            return winner
        await self.session.refresh(reading)
        return reading

    async def save_error(self, event: ClientErrorEvent) -> None:
        if event.user_id is not None:
            result = await self.session.execute(
                select(User)
                .where(User.id == event.user_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            user = result.scalar_one_or_none()
            if user is None or user.deleted_at is not None:
                await self.session.rollback()
                return
        self.session.add(event)
        await self.session.commit()
