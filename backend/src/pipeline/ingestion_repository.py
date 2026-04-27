"""IngestionJob DB CRUD."""

from datetime import datetime

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.pipeline.ingestion_models import IngestionJob, IngestionStatus


class IngestionJobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_volume_key(self, volume_key: str) -> IngestionJob | None:
        stmt = select(IngestionJob).where(IngestionJob.volume_key == volume_key)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert_pending(
        self, volume_key: str, filename: str, source: str
    ) -> IngestionJob:
        """신규 생성 또는 기존 row 상태 초기화 (재업로드 지원)."""
        job = await self.get_by_volume_key(volume_key)
        now = datetime.utcnow()
        if job is None:
            job = IngestionJob(
                volume_key=volume_key,
                filename=filename,
                source=source,
                status=IngestionStatus.PENDING,
                created_at=now,
                updated_at=now,
            )
            self.session.add(job)
        else:
            job.filename = filename
            job.source = source
            job.status = IngestionStatus.PENDING
            job.total_chunks = 0
            job.processed_chunks = 0
            job.error_message = None
            job.completed_at = None
            job.updated_at = now
            self.session.add(job)
        await self.session.flush()
        return job

    async def start_run(self, volume_key: str, total_chunks: int) -> None:
        job = await self.get_by_volume_key(volume_key)
        if job is None:
            return
        job.status = IngestionStatus.RUNNING
        job.total_chunks = total_chunks
        job.updated_at = datetime.utcnow()
        self.session.add(job)
        await self.session.flush()

    async def update_progress(self, volume_key: str, processed_chunks: int) -> None:
        job = await self.get_by_volume_key(volume_key)
        if job is None:
            return
        job.processed_chunks = processed_chunks
        job.updated_at = datetime.utcnow()
        self.session.add(job)
        await self.session.flush()

    async def complete_job(self, volume_key: str, processed_chunks: int) -> None:
        job = await self.get_by_volume_key(volume_key)
        if job is None:
            return
        now = datetime.utcnow()
        job.status = IngestionStatus.COMPLETED
        job.processed_chunks = processed_chunks
        job.completed_at = now
        job.updated_at = now
        self.session.add(job)
        await self.session.flush()

    async def mark_partial(self, volume_key: str, processed_chunks: int) -> None:
        job = await self.get_by_volume_key(volume_key)
        if job is None:
            return
        job.status = IngestionStatus.PARTIAL
        job.processed_chunks = processed_chunks
        job.updated_at = datetime.utcnow()
        self.session.add(job)
        await self.session.flush()

    async def update_content_hash(self, volume_key: str, content_hash: str) -> None:
        """ADR-30 follow-up: 적재 완료 시점에 텍스트 SHA-256 hash를 기록한다.

        skip 모드에서 후속 재업로드 시 이 값과 비교해 콘텐츠 변경 여부를 판단.
        """
        job = await self.get_by_volume_key(volume_key)
        if job is None:
            return
        job.content_hash = content_hash
        job.updated_at = datetime.utcnow()
        self.session.add(job)
        await self.session.flush()

    async def fail_job(self, volume_key: str, reason: str) -> None:
        job = await self.get_by_volume_key(volume_key)
        if job is None:
            return
        now = datetime.utcnow()
        job.status = IngestionStatus.FAILED
        job.error_message = reason
        job.completed_at = now
        job.updated_at = now
        self.session.add(job)
        await self.session.flush()

    async def list_all(self) -> list[IngestionJob]:
        stmt = select(IngestionJob).order_by(IngestionJob.created_at.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def commit(self) -> None:
        await self.session.commit()
