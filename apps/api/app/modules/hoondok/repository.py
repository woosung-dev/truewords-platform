"""훈독 Repository — AsyncSession 은 여기만 보유한다."""

import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import DailyReading, MissionLog


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


class MissionLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, log: MissionLog) -> MissionLog:
        """unique(user·date·kind) 위반은 IntegrityError 그대로 — service 가 409 로 바꾼다."""
        self.session.add(log)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(log)
        return log

    async def list_dates(self, user_id: uuid.UUID, kind: str) -> list[date]:
        """한 사용자·한 종류의 완료일 전량 (베타 규모, 연속일 계산용)."""
        result = await self.session.execute(
            select(MissionLog.mission_date)
            .where(MissionLog.user_id == user_id, MissionLog.kind == kind)
            .order_by(MissionLog.mission_date)
        )
        return list(result.scalars().all())

    async def kinds_on(self, user_id: uuid.UUID, mission_date: date) -> set[str]:
        result = await self.session.execute(
            select(MissionLog.kind).where(MissionLog.user_id == user_id, MissionLog.mission_date == mission_date)
        )
        return set(result.scalars().all())
