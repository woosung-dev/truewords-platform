"""Batch 임베딩 오케스트레이션 — 제출, 폴링, 적재.

raw httpx (HTTP/1.1) 클라이언트 사용 — qdrant-client SDK HTTP/2 hang 회피
(PR #78 진단, docs/dev-log/47 참조).
"""

import json
import logging
import uuid
from pathlib import Path
from tempfile import mkdtemp

from src.pipeline.batch_embedder import (
    prepare_batch_input,
    submit_batch_job,
    check_batch_status,
    download_batch_results,
)
from src.pipeline.batch_models import BatchJob, BatchStatus
from src.pipeline.batch_repository import BatchJobRepository
from src.pipeline.chunk_payload import QdrantChunkPayload
from src.pipeline.embedder import embed_sparse_batch
from src.config import settings
from src.qdrant_client import get_raw_client

logger = logging.getLogger(__name__)

_BATCH_DIR = Path(mkdtemp(prefix="truewords_batch_"))


class BatchService:
    def __init__(self, repo: BatchJobRepository) -> None:
        self.repo = repo

    async def submit(
        self,
        chunks_texts: list[str],
        filename: str,
        volume_key: str,
        source: str,
        on_duplicate: str = "merge",
    ) -> BatchJob:
        """배치 임베딩 작업 제출 (ADR-30 follow-up).

        on_duplicate는 ``_ingest_batch_results`` 시점에 payload.source 처리에
        사용된다. skip 모드 사전 차단은 호출 측(_process_file_batch)에서 수행
        — 여기까지 도달한 경우 임베딩 제출은 진행한다.
        """
        job = BatchJob(
            batch_id="",
            filename=filename,
            volume_key=volume_key,
            source=source,
            total_chunks=len(chunks_texts),
            on_duplicate=on_duplicate,
        )

        try:
            jsonl_path = _BATCH_DIR / f"{volume_key}.jsonl"
            prepare_batch_input(chunks_texts, jsonl_path)
            batch_id = submit_batch_job(jsonl_path)
            job.batch_id = batch_id
            job.status = BatchStatus.PENDING
        except Exception as e:
            logger.exception("Batch 제출 실패: %s", filename)
            job.batch_id = f"failed-{volume_key}"
            job.status = BatchStatus.FAILED
            job.error_message = str(e)

        await self.repo.create(job)
        await self.repo.commit()
        return job

    async def poll_and_process(self) -> int:
        """pending/processing 상태 작업을 폴링하여 완료 시 Qdrant 적재.

        Returns:
            처리 완료된 작업 수.
        """
        jobs = await self.repo.list_by_status(
            BatchStatus.PENDING, BatchStatus.PROCESSING
        )
        completed_count = 0

        for job in jobs:
            try:
                result = check_batch_status(job.batch_id)
                status = result["status"]

                if status == "completed":
                    await self._ingest_batch_results(job)
                    await self.repo.update_status(job, BatchStatus.COMPLETED)
                    completed_count += 1
                    logger.info("Batch 완료: %s (%d청크)", job.filename, job.total_chunks)

                elif status == "failed":
                    error = result.get("error", "Unknown error")
                    await self.repo.update_status(job, BatchStatus.FAILED, error)
                    logger.warning("Batch 실패: %s — %s", job.filename, error)

                elif status == "processing" and job.status == BatchStatus.PENDING:
                    await self.repo.update_status(job, BatchStatus.PROCESSING)

            except Exception as e:
                logger.exception("Batch 폴링 오류: %s", job.filename)
                await self.repo.update_status(job, BatchStatus.FAILED, f"폴링 오류: {e}")

        if completed_count > 0 or jobs:
            await self.repo.commit()

        return completed_count

    async def _ingest_batch_results(self, job: BatchJob) -> None:
        """완료된 배치의 임베딩을 다운로드하여 Qdrant에 적재.

        ADR-30 follow-up: ``job.on_duplicate``에 따라 payload.source를 결정한다.
        - merge   : 기존 payload.source ∪ {job.source}
        - replace : [job.source]
        - skip    : 이론상 도달 불가 (_process_file_batch에서 사전 차단)
        """
        dense_embeddings = download_batch_results(job.batch_id)

        # 원본 텍스트를 JSONL에서 복원
        jsonl_path = _BATCH_DIR / f"{job.volume_key}.jsonl"
        texts: list[str] = []
        if jsonl_path.exists():
            with open(jsonl_path, encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        data = json.loads(line)
                        texts.append(data["contents"])

        # Sparse 임베딩 생성 (로컬 CPU)
        sparse_embeddings = embed_sparse_batch(texts) if texts else []

        # ADR-30: 적재 시점에 on_duplicate 정책 적용 → payload_sources 결정
        if job.on_duplicate == "merge":
            from src.datasource.qdrant_service import DataSourceQdrantService
            svc = DataSourceQdrantService(get_raw_client(), settings.collection_name)
            existing_sources, _existing_chunks = await svc.get_volume_snapshot(job.volume_key)
            union = {s for s in existing_sources if s}
            if job.source:
                union.add(job.source)
            payload_sources: list[str] = sorted(union) if union else []
        else:  # replace (skip은 호출 측에서 사전 차단)
            payload_sources = [job.source] if job.source else []

        # Qdrant 적재 (raw httpx async)
        client = get_raw_client()
        points: list[dict] = []
        for i, text in enumerate(texts):
            dense = dense_embeddings[i] if i < len(dense_embeddings) else [0.0] * 1536
            sparse_indices, sparse_values = sparse_embeddings[i] if i < len(sparse_embeddings) else ([], [])

            chunk_key = f"{job.volume_key}:{i}"
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_key))
            points.append(
                {
                    "id": point_id,
                    "vector": {
                        "dense": dense,
                        "sparse": {"indices": sparse_indices, "values": sparse_values},
                    },
                    "payload": QdrantChunkPayload(
                        text=text,
                        volume=job.volume_key,
                        chunk_index=i,
                        source=payload_sources,
                    ).model_dump(),
                }
            )

            # 50개씩 upsert
            if len(points) >= 50:
                await client.upsert(settings.collection_name, points)
                points.clear()

        # 남은 포인트 flush
        if points:
            await client.upsert(settings.collection_name, points)

        # JSONL 임시 파일 삭제
        if jsonl_path.exists():
            jsonl_path.unlink()

        logger.info("Batch 결과 적재 완료: %s (%d포인트)", job.filename, len(texts))
