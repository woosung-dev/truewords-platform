"""Batch Service 단위 테스트."""

from unittest.mock import AsyncMock, patch
from pathlib import Path

import pytest

from src.pipeline.batch_models import BatchJob, BatchStatus
from src.pipeline.batch_service import BatchService


@pytest.fixture
def batch_repo():
    repo = AsyncMock()
    repo.create.side_effect = lambda job: job
    repo.commit = AsyncMock()
    return repo


@pytest.fixture
def service(batch_repo):
    return BatchService(repo=batch_repo)


@pytest.mark.asyncio
async def test_submit_creates_batch_job(service, batch_repo):
    """submit()이 BatchJob을 생성하고 DB에 저장."""
    chunks_texts = ["텍스트1", "텍스트2", "텍스트3"]

    with patch("src.pipeline.batch_service.prepare_batch_input") as mock_prep, \
         patch("src.pipeline.batch_service.submit_batch_job", return_value="batch-abc"):
        mock_prep.return_value = Path("/tmp/test.jsonl")

        job = await service.submit(
            chunks_texts=chunks_texts,
            filename="test.pdf",
            volume_key="test.pdf",
            source="L",
        )

    assert job.batch_id == "batch-abc"
    assert job.status == BatchStatus.PENDING
    assert job.total_chunks == 3
    assert job.filename == "test.pdf"
    batch_repo.create.assert_called_once()
    batch_repo.commit.assert_called_once()


@pytest.mark.asyncio
async def test_submit_failure_creates_failed_job(service, batch_repo):
    """Gemini API 제출 실패 시 status=failed로 저장."""
    with patch("src.pipeline.batch_service.prepare_batch_input") as mock_prep, \
         patch("src.pipeline.batch_service.submit_batch_job", side_effect=Exception("API error")):
        mock_prep.return_value = Path("/tmp/test.jsonl")

        job = await service.submit(
            chunks_texts=["텍스트"],
            filename="fail.pdf",
            volume_key="fail.pdf",
            source="L",
        )

    assert job.status == BatchStatus.FAILED
    assert "API error" in job.error_message
