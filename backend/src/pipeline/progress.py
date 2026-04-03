"""증분 적재 진행 추적. 원자적 저장 (crash-safe)."""

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


class ProgressTracker:
    def __init__(self, filepath: Path) -> None:
        self.filepath = filepath
        self.completed: dict[str, int] = {}  # volume → chunk_count
        self.failed: dict[str, str] = {}     # volume → reason
        self.load()

    def load(self) -> None:
        """JSON 파일에서 진행 상태 로드. 손상 시 빈 상태로 초기화."""
        if not self.filepath.exists():
            return
        try:
            data = json.loads(self.filepath.read_text(encoding="utf-8"))
            self.completed = data.get("completed", {})
            self.failed = data.get("failed", {})
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("progress.json 손상, 빈 상태로 초기화: %s", e)
            # 손상 파일 백업
            backup = self.filepath.with_suffix(".json.bak")
            self.filepath.rename(backup)
            self.completed = {}
            self.failed = {}

    def save(self) -> None:
        """원자적 저장: 임시 파일 → os.replace."""
        tmp_path = self.filepath.with_suffix(".json.tmp")
        data = {"completed": self.completed, "failed": self.failed}
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp_path, self.filepath)

    def is_completed(self, volume: str) -> bool:
        return volume in self.completed

    def mark_completed(self, volume: str, chunk_count: int) -> None:
        self.completed[volume] = chunk_count
        self.save()

    def mark_failed(self, volume: str, reason: str) -> None:
        self.failed[volume] = reason
        self.save()

    def get_summary(self) -> dict:
        return {
            "completed_count": len(self.completed),
            "failed_count": len(self.failed),
            "total_chunks": sum(self.completed.values()),
        }
