"""요약 영속화와 단위별 행 잠금."""

import uuid
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from app.modules.hoondok.models import ContentRight
from app.modules.hoondok.summary_models import (
    SummaryUnit,
    SummaryRevision,
    SummaryAsset,
)


class SummaryRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def units(self, right_id=None):
        q = select(SummaryUnit)
        if right_id:
            q = q.where(SummaryUnit.content_right_id == right_id)
        return list(
            (await self.session.execute(q.order_by(SummaryUnit.slug))).scalars().all()
        )

    async def get(self, unit_id: uuid.UUID, lock=False):
        q = select(SummaryUnit).where(SummaryUnit.id == unit_id)
        if lock:
            q = q.with_for_update()
        return (await self.session.execute(q)).scalar_one_or_none()

    async def right(self, right_id):
        return await self.session.get(ContentRight, right_id)

    async def revision(self, revision_id):
        return await self.session.get(SummaryRevision, revision_id)

    async def assets(self, unit_id):
        return list(
            (
                await self.session.execute(
                    select(SummaryAsset).where(SummaryAsset.unit_id == unit_id)
                )
            )
            .scalars()
            .all()
        )

    async def save(self, row):
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise HTTPException(409, "이미 등록된 고유 주소입니다") from None
        return row
