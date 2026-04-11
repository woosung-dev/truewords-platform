"""Gemini Batch API 래퍼 — 배치 임베딩 제출/폴링/결과 처리."""

import json
import logging
from pathlib import Path

from google import genai
from google.genai import types
from src.config import settings

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=settings.gemini_api_key.get_secret_value())

EMBEDDING_MODEL = "gemini-embedding-001"


def prepare_batch_input(texts: list[str], output_path: Path) -> Path:
    """청크 텍스트를 Gemini Batch API 입력 JSONL로 변환.

    Args:
        texts: 임베딩할 텍스트 리스트.
        output_path: JSONL 파일 저장 경로.

    Returns:
        저장된 JSONL 파일 경로.
    """
    with open(output_path, "w", encoding="utf-8") as f:
        for text in texts:
            line = json.dumps(
                {
                    "contents": text,
                    "config": {
                        "task_type": "RETRIEVAL_DOCUMENT",
                        "output_dimensionality": 1536,
                    },
                },
                ensure_ascii=False,
            )
            f.write(line + "\n")
    return output_path


def submit_batch_job(input_path: Path) -> str:
    """Gemini Batch API에 임베딩 작업 제출.

    Args:
        input_path: prepare_batch_input으로 생성한 JSONL 파일 경로.

    Returns:
        batch_id (Gemini가 반환하는 작업 식별자).
    """
    batch = _client.batches.create(
        model=EMBEDDING_MODEL,
        src=str(input_path),
        config=types.CreateBatchJobConfig(
            display_name=input_path.stem,
        ),
    )
    logger.info("Batch job submitted: %s", batch.name)
    return batch.name


def check_batch_status(batch_id: str) -> dict:
    """배치 작업 상태 확인.

    Returns:
        {"status": "pending"|"processing"|"completed"|"failed",
         "error": str|None}
    """
    batch = _client.batches.get(name=batch_id)
    state = batch.state.value if batch.state else "unknown"

    status_map = {
        "JOB_STATE_PENDING": "pending",
        "JOB_STATE_RUNNING": "processing",
        "JOB_STATE_SUCCEEDED": "completed",
        "JOB_STATE_FAILED": "failed",
        "JOB_STATE_CANCELLED": "failed",
    }

    return {
        "status": status_map.get(state, "pending"),
        "error": str(batch.error) if hasattr(batch, "error") and batch.error else None,
    }


def download_batch_results(batch_id: str) -> list[list[float]]:
    """완료된 배치 작업의 임베딩 결과를 다운로드.

    Returns:
        임베딩 벡터 리스트 (각 1536차원).
    """
    batch = _client.batches.get(name=batch_id)
    embeddings = []

    if hasattr(batch, "dest") and batch.dest:
        for result in _client.batches.list_results(name=batch_id):
            if hasattr(result, "embeddings"):
                for emb in result.embeddings:
                    embeddings.append(list(emb.values))

    logger.info("Downloaded %d embeddings from batch %s", len(embeddings), batch_id)
    return embeddings
