"""IngestionJob 비즈니스 서비스 — /status 응답 조립 및 상태 전이 조율."""

from src.pipeline.ingestion_models import IngestionStatus
from src.pipeline.ingestion_repository import IngestionJobRepository


class IngestionJobService:
    def __init__(self, repo: IngestionJobRepository) -> None:
        self.repo = repo

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
