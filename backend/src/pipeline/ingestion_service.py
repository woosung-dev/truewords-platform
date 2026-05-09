"""IngestionJob 비즈니스 서비스 — /status 응답 조립 및 상태 전이 조율."""

import unicodedata

from src.pipeline.ingestion_models import IngestionJob, IngestionStatus
from src.pipeline.ingestion_repository import IngestionJobRepository


class IngestionJobService:
    def __init__(self, repo: IngestionJobRepository) -> None:
        self.repo = repo

    async def find_by_filename(self, filename: str) -> IngestionJob | None:
        """NFC 정규화된 파일명으로 기존 IngestionJob 조회."""
        volume_key = unicodedata.normalize("NFC", filename)
        return await self.repo.get_by_volume_key(volume_key)

    async def update_display_name(
        self, volume_key: str, display_name: str | None
    ) -> IngestionJob | None:
        """파일별 사용자 친화적 표시명 업데이트 + commit."""
        job = await self.repo.update_display_name(volume_key, display_name)
        if job is not None:
            await self.repo.commit()
        return job

    async def list_jobs(self) -> list[IngestionJob]:
        """admin 화면용 IngestionJob 전체 목록.

        chat 응답의 source 매핑(IngestionJob lookup) 도 동일 list 를 활용한다 —
        호출자가 dict 빌드 후 cache 처리.
        """
        return await self.repo.list_all()

    async def build_status_response(self) -> dict:
        """/status 엔드포인트용 UI 호환 응답 조립.

        기존 ProgressTracker dict 포맷을 그대로 재현하여 프론트 변경을 피한다.
        """
        jobs = await self.repo.list_all()

        completed: dict[str, int] = {}
        failed: dict[str, str] = {}
        in_progress: dict[str, dict] = {}
        total_chunks = 0

        for job in jobs:
            filename = job.filename
            if job.status == IngestionStatus.COMPLETED:
                completed[filename] = job.total_chunks
                total_chunks += job.total_chunks
            elif job.status == IngestionStatus.FAILED:
                failed[filename] = job.error_message or "알 수 없는 오류"
            elif job.status in (IngestionStatus.RUNNING, IngestionStatus.PARTIAL, IngestionStatus.PENDING):
                in_progress[filename] = {
                    "total": job.total_chunks,
                    "next_chunk": job.processed_chunks,
                }

        return {
            "completed": completed,
            "failed": failed,
            "in_progress": in_progress,
            "summary": {
                "completed_count": len(completed),
                "failed_count": len(failed),
                "in_progress_count": len(in_progress),
                "total_chunks": total_chunks,
            },
        }
