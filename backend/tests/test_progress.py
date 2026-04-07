"""진행 추적 모듈 테스트."""

import json
from pathlib import Path

from src.pipeline.progress import ProgressTracker


def test_create_new_progress(tmp_path: Path):
    """파일 없으면 빈 상태로 시작."""
    tracker = ProgressTracker(tmp_path / "progress.json")
    assert tracker.completed == {}
    assert tracker.failed == {}


def test_mark_completed(tmp_path: Path):
    """완료 기록."""
    tracker = ProgressTracker(tmp_path / "progress.json")
    tracker.mark_completed("vol_001", 50)
    assert tracker.is_completed("vol_001")
    assert tracker.completed["vol_001"] == 50


def test_mark_failed(tmp_path: Path):
    """실패 기록 (사유 포함)."""
    tracker = ProgressTracker(tmp_path / "progress.json")
    tracker.mark_failed("vol_002", "임베딩 API 오류")
    assert "vol_002" in tracker.failed
    assert tracker.failed["vol_002"] == "임베딩 API 오류"


def test_is_completed(tmp_path: Path):
    """완료 여부 체크."""
    tracker = ProgressTracker(tmp_path / "progress.json")
    assert not tracker.is_completed("vol_001")
    tracker.mark_completed("vol_001", 30)
    assert tracker.is_completed("vol_001")


def test_save_reload_consistency(tmp_path: Path):
    """저장 후 재로드 일관성."""
    filepath = tmp_path / "progress.json"
    tracker = ProgressTracker(filepath)
    tracker.mark_completed("vol_001", 50)
    tracker.mark_failed("vol_002", "에러")

    # 새 인스턴스로 재로드
    tracker2 = ProgressTracker(filepath)
    assert tracker2.is_completed("vol_001")
    assert tracker2.completed["vol_001"] == 50
    assert tracker2.failed["vol_002"] == "에러"


def test_atomic_save(tmp_path: Path):
    """os.replace 원자적 저장 — 파일이 정상 생성됨."""
    filepath = tmp_path / "progress.json"
    tracker = ProgressTracker(filepath)
    tracker.mark_completed("vol_001", 10)

    assert filepath.exists()
    data = json.loads(filepath.read_text())
    assert data["completed"]["vol_001"] == 10
    # tmp 파일이 남아있지 않아야 함
    assert not filepath.with_suffix(".json.tmp").exists()


def test_corrupted_json_recovery(tmp_path: Path):
    """손상된 JSON 파일 로드 시 빈 상태로 초기화 + .bak 백업 생성."""
    filepath = tmp_path / "progress.json"
    filepath.write_text("{invalid json!!!", encoding="utf-8")

    tracker = ProgressTracker(filepath)

    # 빈 상태로 초기화됨
    assert tracker.completed == {}
    assert tracker.failed == {}
    # 손상 파일이 .bak으로 백업됨
    assert filepath.with_suffix(".json.bak").exists()


def test_mark_chunk_progress(tmp_path: Path):
    """청크 체크포인트 저장."""
    tracker = ProgressTracker(tmp_path / "progress.json")
    tracker.mark_chunk_progress("vol_001.txt", 100, 500)
    assert tracker.in_progress["vol_001.txt"] == {"total": 500, "next_chunk": 100}


def test_get_resume_point_no_entry(tmp_path: Path):
    """진행 기록 없으면 0 반환."""
    tracker = ProgressTracker(tmp_path / "progress.json")
    assert tracker.get_resume_point("vol_001.txt") == 0


def test_get_resume_point_existing(tmp_path: Path):
    """기존 체크포인트에서 재개 지점 반환."""
    tracker = ProgressTracker(tmp_path / "progress.json")
    tracker.mark_chunk_progress("vol_001.txt", 1500, 3000)
    assert tracker.get_resume_point("vol_001.txt") == 1500


def test_mark_completed_clears_in_progress(tmp_path: Path):
    """완료 기록 시 in_progress 제거."""
    tracker = ProgressTracker(tmp_path / "progress.json")
    tracker.mark_chunk_progress("vol_001.txt", 50, 100)
    assert "vol_001.txt" in tracker.in_progress
    tracker.mark_completed("vol_001.txt", 100)
    assert "vol_001.txt" not in tracker.in_progress


def test_in_progress_persists_across_reload(tmp_path: Path):
    """체크포인트가 JSON에 저장되고 재로드 후에도 유지됨."""
    filepath = tmp_path / "progress.json"
    tracker = ProgressTracker(filepath)
    tracker.mark_chunk_progress("vol_001.txt", 200, 1000)

    tracker2 = ProgressTracker(filepath)
    assert tracker2.get_resume_point("vol_001.txt") == 200


def test_get_summary_includes_in_progress_count(tmp_path: Path):
    """get_summary에 in_progress_count 포함."""
    tracker = ProgressTracker(tmp_path / "progress.json")
    tracker.mark_chunk_progress("vol_001.txt", 50, 200)
    summary = tracker.get_summary()
    assert summary["in_progress_count"] == 1
