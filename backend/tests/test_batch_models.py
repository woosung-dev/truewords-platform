"""BatchJob 모델 단위 테스트."""

from src.pipeline.batch_models import BatchJob, BatchStatus


def test_batch_job_default_status():
    job = BatchJob(
        batch_id="batch-123",
        filename="test.pdf",
        volume_key="test.pdf",
        source="L",
        total_chunks=100,
    )
    assert job.status == BatchStatus.PENDING
    assert job.error_message is None
    assert job.completed_at is None


def test_batch_status_values():
    assert BatchStatus.PENDING == "pending"
    assert BatchStatus.PROCESSING == "processing"
    assert BatchStatus.COMPLETED == "completed"
    assert BatchStatus.FAILED == "failed"
