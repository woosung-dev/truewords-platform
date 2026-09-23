"""훈독 Repository — AsyncSession 은 여기만 보유한다."""

import uuid
from datetime import date

from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import ClientErrorEvent, DailyReading, JeongseongPeriod, JeongseongReading, MissionLog
from app.modules.identity.models import User


class DailyReadingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_date(self, reading_date: date) -> DailyReading | None:
        result = await self.session.execute(
            select(DailyReading).where(DailyReading.reading_date == reading_date)
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, reading_id: uuid.UUID) -> DailyReading | None:
        return await self.session.get(DailyReading, reading_id)

    async def list_range(self, start: date, end: date) -> list[DailyReading]:
        """[start, end] 양끝 포함, 날짜 오름차순. 편성 없는 날은 행이 없다 — 빈 날 표시는 화면이 한다."""
        result = await self.session.execute(
            select(DailyReading)
            .where(DailyReading.reading_date >= start, DailyReading.reading_date <= end)
            .order_by(DailyReading.reading_date)
        )
        return list(result.scalars().all())

    async def create(self, reading: DailyReading) -> DailyReading:
        """unique(reading_date) 위반은 IntegrityError 그대로 — 호출자가 409 로 바꾼다. 실패한 세션은 롤백해 재사용 가능하게 둔다."""
        return await self._save(reading)

    async def save(self, reading: DailyReading) -> DailyReading:
        """수정 저장. 날짜 변경으로 unique 를 어기면 IntegrityError."""
        return await self._save(reading)

    async def _save(self, reading: DailyReading) -> DailyReading:
        self.session.add(reading)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
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

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """계정 삭제(API-HD-011)의 일부 — 커밋하지 않는다. 같은 세션을 쓰는 호출자가 사용자 저장과 함께 한 번에 커밋한다."""
        await self.session.execute(delete(MissionLog).where(MissionLog.user_id == user_id))

    async def count_users_on(self, mission_date: date, kind: str) -> int:
        """그날 그 kind 를 완료한 서로 다른 사용자 수 (API-HD-029). 소프트 삭제(deleted_at) 사용자는 뺀다.

        unique(user·date·kind) 라 사용자당 1행이지만 DISTINCT 로 그 가정에 기대지 않는다.
        """
        result = await self.session.execute(
            select(func.count(func.distinct(MissionLog.user_id)))
            .join(User, User.id == MissionLog.user_id)
            .where(MissionLog.mission_date == mission_date, MissionLog.kind == kind, User.deleted_at.is_(None))
        )
        return int(result.scalar_one())


class JeongseongRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_active(self, user_id: uuid.UUID) -> JeongseongPeriod | None:
        """진행 중(active) 기간. 부분 unique 가 사용자당 1건을 보장한다."""
        result = await self.session.execute(
            select(JeongseongPeriod).where(JeongseongPeriod.user_id == user_id, JeongseongPeriod.status == "active").execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def create(self, period: JeongseongPeriod) -> JeongseongPeriod:
        """부분 unique(user·active) 위반은 IntegrityError 그대로 — service 가 409 로 바꾼다."""
        return await self._save(period)

    async def save(self, period: JeongseongPeriod) -> JeongseongPeriod:
        """상태 전이(completed·abandoned) 저장."""
        return await self._save(period)

    async def _save(self, period: JeongseongPeriod) -> JeongseongPeriod:
        self.session.add(period)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(period)
        return period

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """계정 삭제(API-HD-011)의 일부 — 커밋하지 않는다. MissionLogRepository.delete_for_user 와 같은 규약."""
        # 자식 삭제 전에 부모를 잠가 새 말씀 저장이 DELETE 사이에 끼어들지 못하게 한다.
        locked = await self.session.execute(
            select(JeongseongPeriod.id).where(JeongseongPeriod.user_id == user_id).with_for_update()
        )
        period_ids = list(locked.scalars().all())
        await self.session.execute(delete(JeongseongReading).where(JeongseongReading.period_id.in_(period_ids)))
        await self.session.execute(delete(ClientErrorEvent).where(ClientErrorEvent.user_id == user_id))
        await self.session.execute(delete(JeongseongPeriod).where(JeongseongPeriod.user_id == user_id))
