"""배치 통계 리포트 테스트."""

import json
from pathlib import Path

from src.pipeline.reporter import BatchReporter


def test_generate_report_creates_json(tmp_path: Path):
    """reports/ 디렉토리에 JSON 파일 생성."""
    reporter = BatchReporter()
    reporter.add_volume_stat("vol_001", 50, 12.5)
    filepath = reporter.generate(tmp_path / "reports")
    assert filepath.exists()
    assert filepath.suffix == ".json"


def test_report_contains_volume_stats(tmp_path: Path):
    """권별 청크 수, 소요 시간 포함."""
    reporter = BatchReporter()
    reporter.add_volume_stat("vol_001", 50, 12.5)
    reporter.add_volume_stat("vol_002", 30, 8.2)
    filepath = reporter.generate(tmp_path / "reports")

    data = json.loads(filepath.read_text())
    assert data["total_volumes"] == 2
    assert data["total_chunks"] == 80
    assert len(data["volumes"]) == 2


def test_report_contains_error_summary(tmp_path: Path):
    """오류 목록 포함."""
    reporter = BatchReporter()
    reporter.add_error("vol_003", "임베딩 실패")
    filepath = reporter.generate(tmp_path / "reports")

    data = json.loads(filepath.read_text())
    assert len(data["errors"]) == 1
    assert data["errors"][0]["volume"] == "vol_003"


def test_report_filename_has_timestamp(tmp_path: Path):
    """파일명에 타임스탬프 포함."""
    reporter = BatchReporter()
    filepath = reporter.generate(tmp_path / "reports")
    assert "report_" in filepath.name
    assert len(filepath.stem) > len("report_")
