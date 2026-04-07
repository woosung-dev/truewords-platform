"""Qdrant 적재. 배치 임베딩 + 지수 백오프 + 메타 payload + 적재 통계."""

import logging
import time
import uuid

from google.genai import errors as genai_errors
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, SparseVector

from src.config import settings
from src.pipeline.chunker import Chunk
from src.pipeline.embedder import EMBED_BATCH_SIZE, embed_dense_batch, embed_sparse

logger = logging.getLogger(__name__)

# Qdrant upsert 배치 크기
_UPSERT_BATCH_SIZE = 50


def _embed_batch_with_retry(texts: list[str]) -> list[list[float]]:
    """배치 임베딩 + Rate limit 대응 지수 백오프."""
    base_wait = getattr(settings, "retry_base_wait", 30.0)
    max_retries = getattr(settings, "retry_max_retries", 5)

    for attempt in range(max_retries):
        try:
            return embed_dense_batch(texts)
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
) -> dict:
    """청크 적재. 배치 임베딩으로 API 호출 최소화.

    반환: {"chunk_count": int, "elapsed_sec": float}."""
    if not chunks:
        return {"chunk_count": 0, "elapsed_sec": 0.0}

    start = time.monotonic()
    points: list[PointStruct] = []
    total = len(chunks)

    # 배치 단위로 dense 임베딩 처리
    for batch_start in range(0, total, EMBED_BATCH_SIZE):
        batch_end = min(batch_start + EMBED_BATCH_SIZE, total)
        batch_chunks = chunks[batch_start:batch_end]
        batch_texts = [c.text for c in batch_chunks]

        # Dense 임베딩 (1회 API 호출로 최대 50개 처리)
        dense_vectors = _embed_batch_with_retry(batch_texts)

        # Sparse 임베딩 (로컬 CPU, API 호출 없음)
        for i, chunk in enumerate(batch_chunks):
            sparse_indices, sparse_values = embed_sparse(chunk.text)

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

        # Qdrant upsert (points가 충분히 쌓이면)
        if len(points) >= _UPSERT_BATCH_SIZE:
            client.upsert(collection_name=collection_name, points=points)
            logger.info("  [%d/%d] 청크 적재 중...", batch_end, total)
            points = []

        # TPM 한도 대응: 배치 간 1초 대기 (분당 ~50 배치 × 50청크 = 2,500 < TPM 30K)
        time.sleep(1.0)

    # 남은 points 적재
    if points:
        client.upsert(collection_name=collection_name, points=points)
        logger.info("  [%d/%d] 청크 적재 완료", total, total)

    elapsed = time.monotonic() - start
    return {"chunk_count": total, "elapsed_sec": round(elapsed, 2)}
