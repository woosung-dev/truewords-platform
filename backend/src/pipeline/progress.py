"""증분 적재 진행 추적. 원자적 저장 (crash-safe). 청크 레벨 체크포인트 지원."""

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


class ProgressTracker:
    def __init__(self, filepath: Path) -> None:
        self.filepath = filepath
        self.completed: dict[str, int] = {}   # volume → chunk_count
        self.failed: dict[str, str] = {}       # volume → reason
        self.in_progress: dict[str, dict] = {} # volume → {total, next_chunk}
        self.load()

    def load(self) -> None:
        """JSON 파일에서 진행 상태 로드. 손상 시 빈 상태로 초기화."""
        if not self.filepath.exists():
            return
        try:
            data = json.loads(self.filepath.read_text(encoding="utf-8"))
            self.completed = data.get("completed", {})
            self.failed = data.get("failed", {})
            self.in_progress = data.get("in_progress", {})
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("progress.json 손상, 빈 상태로 초기화: %s", e)
            backup = self.filepath.with_suffix(".json.bak")
            self.filepath.rename(backup)
            self.completed = {}
            self.failed = {}
            self.in_progress = {}

    def save(self) -> None:
        """원자적 저장: 임시 파일 → os.replace."""
        tmp_path = self.filepath.with_suffix(".json.tmp")
        data = {
            "completed": self.completed,
            "failed": self.failed,
            "in_progress": self.in_progress,
        }
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp_path, self.filepath)

    def is_completed(self, volume: str) -> bool:
        return volume in self.completed

    def mark_completed(self, volume: str, chunk_count: int) -> None:
        self.completed[volume] = chunk_count
        self.in_progress.pop(volume, None)  # 체크포인트 제거
        self.save()

    def mark_failed(self, volume: str, reason: str) -> None:
        self.failed[volume] = reason
        self.save()

    def mark_chunk_progress(self, volume: str, next_chunk: int, total: int) -> None:
        """배치 upsert 완료 후 체크포인트 저장. next_chunk = 다음에 시작할 청크 인덱스."""
        self.in_progress[volume] = {"total": total, "next_chunk": next_chunk}
        self.save()

    def get_resume_point(self, volume: str) -> int:
        """이전 중단 지점 반환. 없으면 0 (처음부터)."""
        return self.in_progress.get(volume, {}).get("next_chunk", 0)

    def get_summary(self) -> dict:
        return {
            "completed_count": len(self.completed),
            "failed_count": len(self.failed),
            "in_progress_count": len(self.in_progress),
            "total_chunks": sum(self.completed.values()),
        }
