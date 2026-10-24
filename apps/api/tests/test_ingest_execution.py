"""소스 문자열 대신 적재 실행 결과로 재업로드·부분 적재·정리를 검증한다."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.modules.admin import ingest_service as service
from app.modules.pipeline import ingestor
from app.modules.pipeline.ingestion_models import IngestionStatus
from app.modules.pipeline.ingestion_repository import IngestionJobRepository


@pytest.fixture
def execution(tmp_path, monkeypatch):
    path = tmp_path / "말씀.txt"
    path.write_text("원문")
    repo = AsyncMock(spec=IngestionJobRepository)
    repo.get_by_volume_key.return_value = None
    monkeypatch.setattr(service, "extract_text", Mock(return_value="원문"))
    monkeypatch.setattr(
        service,
        "extract_metadata",
        Mock(return_value={"volume": "v", "title": "제목", "date": ""}),
    )
    monkeypatch.setattr(service, "classify_book_series", Mock(return_value=""))
    monkeypatch.setattr(
        service, "chunk_recursive", Mock(return_value=[object(), object(), object()])
    )
    snapshot = AsyncMock(return_value=(["B"], 0))
    monkeypatch.setattr(service, "_get_existing_snapshot", snapshot)
    ingest = Mock(
        return_value={
            "chunk_count": 3,
            "total_chunks": 3,
            "elapsed_sec": 0,
            "is_partial": False,
        }
    )
    monkeypatch.setattr(service, "ingest_chunks", ingest)
    delete = Mock()
    monkeypatch.setattr(ingestor, "_sync_delete_by_filter", delete)

    def run(policy="merge"):
        service._run_file_standard(
            path,
            path.name,
            "A",
            policy,
            run_repo=lambda fn: asyncio.run(fn(repo)),
            run_async=asyncio.run,
        )

    return SimpleNamespace(
        path=path, repo=repo, snapshot=snapshot, ingest=ingest, delete=delete, run=run
    )


def job(status, *, same_hash=True, processed=3, total=3):
    return SimpleNamespace(
        status=status,
        processed_chunks=processed,
        total_chunks=total,
        content_hash=service._compute_content_hash("원문") if same_hash else "old",
    )


def test_skip_completed_same_content_does_not_delete_or_embed(execution):
    e = execution
    e.repo.get_by_volume_key.return_value = job(IngestionStatus.COMPLETED)
    e.snapshot.return_value = (["B"], 3)
    e.run("skip")
    e.ingest.assert_not_called()
    e.delete.assert_not_called()
    e.repo.complete_job.assert_awaited_once_with("말씀.txt", 3, total_chunks=3)
    assert not e.path.exists()


@pytest.mark.parametrize("policy", ["merge", "replace", "skip"])
def test_completed_changed_content_restarts_from_zero(execution, policy):
    e = execution
    e.repo.get_by_volume_key.return_value = job(
        IngestionStatus.COMPLETED, same_hash=False
    )
    e.snapshot.return_value = (["B"], 3)
    e.run(policy)
    e.delete.assert_called_once()
    assert e.ingest.call_args.kwargs["start_chunk"] == 0
    assert e.ingest.call_args.kwargs["payload_sources"] == (
        None if policy == "replace" else ["A", "B"]
    )
    e.repo.complete_job.assert_awaited_once_with("말씀.txt", 3, total_chunks=3)
    assert not e.path.exists()


def test_partial_continues_and_keeps_progress(execution):
    e = execution
    e.repo.get_by_volume_key.return_value = job(IngestionStatus.PARTIAL, processed=1)
    e.snapshot.return_value = (["B"], 1)
    e.ingest.return_value = {
        "chunk_count": 1,
        "total_chunks": 3,
        "elapsed_sec": 0,
        "is_partial": True,
    }
    e.run()
    e.delete.assert_not_called()
    assert e.ingest.call_args.kwargs["start_chunk"] == 1
    e.repo.mark_partial.assert_awaited_once_with("말씀.txt", 2)
    e.repo.complete_job.assert_not_awaited()
    assert not e.path.exists()


def test_provider_failure_marks_failed_and_removes_file(execution):
    e = execution
    e.ingest.side_effect = RuntimeError("fixture failure")
    e.run()
    e.repo.fail_job.assert_awaited_once_with("말씀.txt", "fixture failure")
    assert not e.path.exists()
