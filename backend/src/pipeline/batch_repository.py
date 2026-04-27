"""BatchJob DB CRUD."""

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.pipeline.batch_models import BatchJob, BatchStatus


class BatchJobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, job: BatchJob) -> BatchJob:
        self.session.add(job)
        await self.session.flush()
        return job

    async def get_by_batch_id(self, batch_id: str) -> BatchJob | None:
        stmt = select(BatchJob).where(BatchJob.batch_id == batch_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_status(self, *statuses: BatchStatus) -> list[BatchJob]:
        stmt = (
            select(BatchJob)
            .where(BatchJob.status.in_(statuses))
            .order_by(BatchJob.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_recent(self, limit: int = 20) -> list[BatchJob]:
        stmt = (
            select(BatchJob)
            .order_by(BatchJob.created_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def update_status(
        self, job: BatchJob, status: BatchStatus, error_message: str | None = None
    ) -> BatchJob:
        job.status = status
        if error_message is not None:
            job.error_message = error_message
        if status == BatchStatus.COMPLETED or status == BatchStatus.FAILED:
            from datetime import datetime
            job.completed_at = datetime.utcnow()
        self.session.add(job)
        await self.session.flush()
        return job

    async def delete_by_volume_key(self, volume_key: str) -> int:
        """volume_key 일치하는 BatchJob row를 모두 삭제. 같은 파일이 여러 batch에 있을 수
        있으므로(과거 시도 등) 모든 row를 fetch 후 개별 delete.

        Returns: 삭제된 row 수.
        """
        stmt = select(BatchJob).where(BatchJob.volume_key == volume_key)
        result = await self.session.execute(stmt)
        jobs = list(result.scalars().all())
        for job in jobs:
            await self.session.delete(job)
        if jobs:
            await self.session.flush()
        return len(jobs)

    async def commit(self) -> None:
        await self.session.commit()
