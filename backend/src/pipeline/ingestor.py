"""Qdrant 적재. 지수 백오프 + 메타 payload + 적재 통계."""

import time
import uuid

from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, SparseVector

from src.config import settings
from src.pipeline.chunker import Chunk
from src.pipeline.embedder import embed_dense_document, embed_sparse

_BATCH_SIZE = 10


def _embed_with_retry(text: str) -> list[float]:
    """Rate limit 대응 지수 백오프 임베딩."""
    from google.genai import errors as genai_errors

    base_wait = getattr(settings, "retry_base_wait", 30.0)
    max_retries = getattr(settings, "retry_max_retries", 5)
    delay = getattr(settings, "embed_delay", 0.2)

    for attempt in range(max_retries):
        try:
            result = embed_dense_document(text)
            time.sleep(delay)
            return result
        except genai_errors.ClientError as e:
            if e.code != 429:
                raise
            if attempt < max_retries - 1:
                wait = base_wait * (2 ** attempt)
                print(f"  Rate limit, {wait:.0f}초 대기 (시도 {attempt + 1}/{max_retries})")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError(f"임베딩 실패: {max_retries}회 재시도 소진")


def ingest_chunks(
    client: QdrantClient,
    collection_name: str,
    chunks: list[Chunk],
) -> dict:
    """청크 적재. 반환: {"chunk_count": int, "elapsed_sec": float}."""
    if not chunks:
        return {"chunk_count": 0, "elapsed_sec": 0.0}

    start = time.monotonic()
    batch: list[PointStruct] = []

    for i, chunk in enumerate(chunks):
        dense = _embed_with_retry(chunk.text)
        sparse_indices, sparse_values = embed_sparse(chunk.text)

        batch.append(
            PointStruct(
                id=str(uuid.uuid4()),
                vector={
                    "dense": dense,
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

        if len(batch) >= _BATCH_SIZE:
            client.upsert(collection_name=collection_name, points=batch)
            print(f"  [{i + 1}/{len(chunks)}] 청크 적재 중...")
            batch = []

    if batch:
        client.upsert(collection_name=collection_name, points=batch)
        print(f"  [{len(chunks)}/{len(chunks)}] 청크 적재 완료")

    elapsed = time.monotonic() - start
    return {"chunk_count": len(chunks), "elapsed_sec": round(elapsed, 2)}
