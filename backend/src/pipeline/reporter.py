"""배치 적재 통계 리포트."""

import json
from datetime import datetime, timezone
from pathlib import Path


class BatchReporter:
    def __init__(self) -> None:
        self.volumes: list[dict] = []
        self.errors: list[dict] = []

    def add_volume_stat(self, volume: str, chunk_count: int, elapsed_sec: float) -> None:
        self.volumes.append({
            "volume": volume,
            "chunks": chunk_count,
            "time_sec": round(elapsed_sec, 2),
        })

    def add_error(self, volume: str, error: str) -> None:
        self.errors.append({"volume": volume, "error": error})

    def generate(self, output_dir: Path) -> Path:
        """리포트 JSON 생성. 파일명에 타임스탬프 포함."""
        output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filepath = output_dir / f"report_{timestamp}.json"

        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_volumes": len(self.volumes),
            "total_chunks": sum(v["chunks"] for v in self.volumes),
            "total_time_sec": round(sum(v["time_sec"] for v in self.volumes), 2),
            "volumes": self.volumes,
            "errors": self.errors,
        }

        filepath.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        return filepath
