"""IngestionJob DB CRUD."""

from datetime import datetime

from sqlalchemy import func
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

    async def complete_job(
        self,
        volume_key: str,
        processed_chunks: int,
        *,
        total_chunks: int | None = None,
    ) -> None:
        """COMPLETED 상태로 전이.

        ADR-30 follow-up: skip 단축 경로처럼 upsert_pending이 total_chunks를 0으로
        리셋한 뒤 호출되는 경우 ``total_chunks``를 명시 전달해 dashboard 표시
        정확성을 회복한다. None이면 기존 값 유지.
        """
        job = await self.get_by_volume_key(volume_key)
        if job is None:
            return
        now = datetime.utcnow()
        job.status = IngestionStatus.COMPLETED
        job.processed_chunks = processed_chunks
        if total_chunks is not None:
            job.total_chunks = total_chunks
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

    async def delete_by_volume_key(self, volume_key: str) -> bool:
        """volume(파일) 단위로 IngestionJob row를 영구 삭제한다.

        Returns: True면 row를 찾아 삭제, False면 없어서 skip.
        """
        job = await self.get_by_volume_key(volume_key)
        if job is None:
            return False
        await self.session.delete(job)
        await self.session.flush()
        return True

    async def list_all(self) -> list[IngestionJob]:
        stmt = select(IngestionJob).order_by(IngestionJob.created_at.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_max_completed_at(self) -> float:
        """현재 corpus 의 max(completed_at) Unix timestamp.

        Cache invalidation trigger — semantic_cache 의 corpus_updated_at filter
        에 사용. ingestion 갱신 시 자동으로 stale cache 무효화된다.

        반환값:
          - COMPLETED 상태 row 가 1건 이상이면 가장 최근 completed_at 의 unix ts
          - 0건이면 0.0 (cache filter 가 모든 cache 를 valid 로 처리)
        """
        stmt = select(func.max(IngestionJob.completed_at)).where(
            IngestionJob.status == IngestionStatus.COMPLETED
        )
        result = await self.session.execute(stmt)
        latest = result.scalar_one_or_none()
        return latest.timestamp() if latest is not None else 0.0

    async def commit(self) -> None:
        await self.session.commit()
