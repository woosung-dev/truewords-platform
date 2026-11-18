"""원문 스냅샷·편집 구간의 저장과 행 잠금."""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from app.modules.hoondok.models import ContentRight, VolumeSection
from app.modules.hoondok.source_models import SourceSnapshot, SourceRange
from app.modules.pipeline.ingestion_models import IngestionJob


class SourceRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def books(self):
        return list((await self.session.execute(select(ContentRight).where(ContentRight.status == 'allowed', ContentRight.scope_full_text == True).order_by(ContentRight.work_title))).scalars().all())  # noqa: E712

    async def right(self, right_id):
        return await self.session.get(ContentRight, right_id)

    async def job(self, volume):
        return (await self.session.execute(select(IngestionJob).where(IngestionJob.volume_key == volume))).scalar_one_or_none()

    async def sections(self, volume):
        return list((await self.session.execute(select(VolumeSection).where(VolumeSection.volume == volume).order_by(VolumeSection.position))).scalars().all())

    async def snapshot(self, snapshot_id):
        return await self.session.get(SourceSnapshot, snapshot_id)

    async def snapshot_by_hash(self, right_id, fingerprint):
        return (await self.session.execute(select(SourceSnapshot).where(SourceSnapshot.content_right_id == right_id, SourceSnapshot.fingerprint == fingerprint))).scalar_one_or_none()

    async def ranges(self, right_id=None):
        query = select(SourceRange).where(SourceRange.archived == False)  # noqa: E712
        if right_id:
            query = query.where(SourceRange.content_right_id == right_id)
        return list((await self.session.execute(query.order_by(SourceRange.updated_at))).scalars().all())

    async def range(self, range_id, lock=False):
        query = select(SourceRange).where(SourceRange.id == range_id)
        if lock:
            query = query.with_for_update()
        return (await self.session.execute(query)).scalar_one_or_none()

    async def save(self, row):
        self.session.add(row)
        await self.session.flush()
        return row

    async def save_snapshot(self, row):
        from sqlalchemy.exc import IntegrityError
        self.session.add(row)
        try:
            await self.session.commit()
            return row
        except IntegrityError:
            await self.session.rollback()
            existing = await self.snapshot_by_hash(row.content_right_id, row.fingerprint)
            if existing is None:
                raise
            return existing
