"""Qdrant 적재. 배치 임베딩 + 청크 레벨 체크포인트 + 지수 백오프."""

from __future__ import annotations

import logging
import time
import uuid
from typing import TYPE_CHECKING

from google.genai import errors as genai_errors
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, SparseVector

from src.config import settings
from src.pipeline.chunker import Chunk
from src.pipeline.embedder import EMBED_BATCH_SIZE, embed_dense_batch, embed_sparse_batch

if TYPE_CHECKING:
    from src.pipeline.progress import ProgressTracker

logger = logging.getLogger(__name__)

# Qdrant upsert 배치 크기
_UPSERT_BATCH_SIZE = 50


def _embed_batch_with_retry(texts: list[str], title: str = "") -> list[list[float]]:
    """배치 임베딩 + Rate limit 대응 지수 백오프."""
    base_wait = getattr(settings, "retry_base_wait", 30.0)
    max_retries = getattr(settings, "retry_max_retries", 5)

    for attempt in range(max_retries):
        try:
            return embed_dense_batch(texts, title=title)
        except genai_errors.ClientError as e:
            if e.code != 429:
                raise
            if attempt < max_retries - 1:
                wait = base_wait * (2 ** attempt)
                logger.warning("Rate limit, %.0f초 대기 (시도 %d/%d)", wait, attempt + 1, max_retries)
                time.sleep(wait)
            else:
                raise
    raise RuntimeError(f"배치 임베딩 실패: {max_retries}회 재시도 소진")


def ingest_chunks(
    client: QdrantClient,
    collection_name: str,
    chunks: list[Chunk],
    start_chunk: int = 0,
    title: str = "",
    tracker: ProgressTracker | None = None,
    volume_key: str = "",
) -> dict:
    """청크 적재. 배치 임베딩 + 청크 레벨 체크포인트.

    Args:
        start_chunk: 재개 시작 인덱스 (0 = 처음부터). tracker.get_resume_point()에서 전달.
        title: 임베딩 품질 향상을 위한 문서 제목 (Gemini 권장).
        tracker: 체크포인트 저장용 ProgressTracker 인스턴스.
        volume_key: tracker에 저장할 볼륨 키 (보통 파일명).

    반환: {"chunk_count": int, "elapsed_sec": float}
    """
    if not chunks:
        return {"chunk_count": 0, "elapsed_sec": 0.0}

    total = len(chunks)

    # start_chunk부터 슬라이스 (이미 완료된 청크 건너뜀)
    effective_chunks = chunks[start_chunk:]
    effective_total = len(effective_chunks)

    if effective_total == 0:
        logger.info("모든 청크 이미 적재됨 (start_chunk=%d, total=%d)", start_chunk, total)
        return {"chunk_count": 0, "elapsed_sec": 0.0}

    start = time.monotonic()
    points: list[PointStruct] = []

    for batch_offset in range(0, effective_total, EMBED_BATCH_SIZE):
        batch_end = min(batch_offset + EMBED_BATCH_SIZE, effective_total)
        batch_chunks = effective_chunks[batch_offset:batch_end]
        batch_texts = [c.text for c in batch_chunks]

        # 이 배치의 절대 인덱스 (전체 chunks 기준)
        abs_batch_end = start_chunk + batch_end

        # Dense 임베딩 (배치, 1회 API 호출, title 포함)
        dense_vectors = _embed_batch_with_retry(batch_texts, title=title)

        # Sparse 임베딩 (배치, 로컬 CPU, API 호출 없음)
        sparse_results = embed_sparse_batch(batch_texts)

        for i, chunk in enumerate(batch_chunks):
            sparse_indices, sparse_values = sparse_results[i]
            points.append(
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector={
                        "dense": dense_vectors[i],
                        "sparse": SparseVector(
                            indices=sparse_indices,
                            values=sparse_values,
                        ),
                    },
                    payload={
                        "text": chunk.text,
                        "volume": chunk.volume,
                        "chunk_index": chunk.chunk_index,
                        "source": chunk.source,
                        "title": chunk.title,
                        "date": chunk.date,
                    },
                )
            )

        # Qdrant upsert (충분히 쌓이면 flush)
        if len(points) >= _UPSERT_BATCH_SIZE:
            client.upsert(collection_name=collection_name, points=points)
            logger.info("  [%d/%d] 청크 적재 중...", abs_batch_end, total)
            points = []

            # 체크포인트 저장 (upsert 성공 후에만)
            if tracker and volume_key:
                tracker.mark_chunk_progress(volume_key, abs_batch_end, total)

        # TPM 한도 대응: 90청크 × 200토큰 = 18K 토큰/배치, 65초 sleep으로 60초 윈도우에 1배치만
        # 유료(TPM 1M) 전환 시: .env에서 EMBED_BATCH_SLEEP=3 으로 변경
        time.sleep(getattr(settings, "embed_batch_sleep", 40.0))

    # 남은 points flush
    if points:
        client.upsert(collection_name=collection_name, points=points)
        logger.info("  [%d/%d] 청크 적재 완료", total, total)
        if tracker and volume_key:
            tracker.mark_chunk_progress(volume_key, total, total)

    elapsed = time.monotonic() - start
    return {"chunk_count": effective_total, "elapsed_sec": round(elapsed, 2)}
