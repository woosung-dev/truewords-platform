"""Qdrant 적재 — 배치 임베딩 + 청크 레벨 체크포인트.

청크 리스트를 받아 dense/sparse 임베딩 후 Qdrant에 upsert한다.
429 발생 시 지수 백오프(90→180초)로 재시도한다.
재업로드를 통한 청크 레벨 체크포인트 재개를 지원한다.
"""

from __future__ import annotations

import logging
import math
import time
import uuid
from typing import Callable

from google.genai import errors as genai_errors
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, SparseVector

from src.config import settings
from src.pipeline.chunk_payload import QdrantChunkPayload
from src.pipeline.chunker import Chunk
from src.pipeline.embedder import MAX_TEXTS_PER_BATCH, embed_dense_batch, embed_sparse_batch

logger = logging.getLogger(__name__)

# Qdrant upsert 배치 크기
_UPSERT_BATCH_SIZE = 50


def _build_text_for_embedding(chunk: Chunk) -> str:
    """Anthropic Contextual Retrieval prefix가 있으면 prepend, 없으면 원문만 (옵션 B)."""
    if chunk.prefix_text:
        return f"{chunk.prefix_text}\n\n{chunk.text}"
    return chunk.text


def _embed_batch_with_retry(texts: list[str], title: str = "") -> list[list[float]]:
    """배치 dense 임베딩 + 429 지수 백오프 (90→180초, 최대 3회).

    SDK 내부 retry에서 429를 제외했으므로 여기서 직접 제어한다.

    Args:
        texts: 임베딩할 텍스트 리스트.
        title: Gemini 임베딩 품질 향상용 문서 제목.

    Returns:
        각 텍스트에 대응하는 dense 벡터 리스트.

    Raises:
        google.genai.errors.ClientError: 429 외 API 에러 또는 3회 재시도 소진.
    """
    base_wait = getattr(settings, "retry_base_wait", 90.0)
    max_retries = 2

    for attempt in range(max_retries):
        try:
            return embed_dense_batch(texts, title=title)
        except genai_errors.ClientError as e:
            if e.code != 429:
                raise

            api_message = str(e)

            if attempt < max_retries - 1:
                wait = base_wait * (2 ** attempt)
                logger.warning(
                    "Rate limit 429 — %.0f초 대기 (시도 %d/%d)\n"
                    "  API 원본 에러: %s",
                    wait, attempt + 1, max_retries,
                    api_message,
                )
                time.sleep(wait)
            else:
                logger.error(
                    "Rate limit 3회 연속 실패 — 파이프라인 중단.\n"
                    "  API 원본 에러: %s\n"
                    "  → 에러 메시지를 확인하여 RPM/RPD/TPM 중 어디에 걸렸는지 판단하세요.",
                    api_message,
                )
                raise
    raise RuntimeError("배치 임베딩 실패: 3회 재시도 소진")


def ingest_chunks(
    client: QdrantClient,
    collection_name: str,
    chunks: list[Chunk],
    start_chunk: int = 0,
    title: str = "",
    on_progress: Callable[[int], None] | None = None,
    payload_sources: list[str] | None = None,
) -> dict:
    """청크를 배치 임베딩 후 Qdrant에 upsert — 청크 레벨 체크포인트 지원.

    동적 배치(글자 수 기준)로 묶어 dense + sparse 임베딩을 수행하고,
    ``_UPSERT_BATCH_SIZE`` 단위로 Qdrant에 upsert한다.
    429 발생 시 재시도하며, 3회 소진 시 부분 완료로 처리한다.

    Args:
        client: Qdrant 동기 클라이언트.
        collection_name: 적재 대상 Qdrant 컬렉션명.
        chunks: 적재할 Chunk 리스트.
        start_chunk: 재개 시작 인덱스 (0이면 처음부터).
        title: Gemini 임베딩 품질 향상용 문서 제목.
        on_progress: upsert 성공 시 누적 처리 청크 수(abs_batch_end)를 전달받는 콜백.
            None이면 체크포인트 저장을 생략한다.
        payload_sources: 모든 청크에 적용할 source 리스트. None이면 chunk.source를
            그대로 사용. 재업로드 merge 모드에서 기존 ∪ 신규 source를 미리 계산해
            전달한다. ADR-30 참조.

    Returns:
        dict: chunk_count, total_chunks, elapsed_sec, is_partial.
    """
    if not chunks:
        return {"chunk_count": 0, "total_chunks": 0, "elapsed_sec": 0.0, "is_partial": False}

    total = len(chunks)

    # start_chunk부터 슬라이스 (이미 완료된 청크 건너뜀)
    effective_chunks = chunks[start_chunk:]
    effective_total = len(effective_chunks)

    if effective_total == 0:
        logger.info("모든 청크 이미 적재됨 (start_chunk=%d, total=%d)", start_chunk, total)
        return {"chunk_count": 0, "total_chunks": 0, "elapsed_sec": 0.0, "is_partial": False}

    max_chars: int = settings.embed_max_chars_per_batch or 31000
    batch_sleep: float = settings.embed_batch_sleep or 60.0
    total_chars = sum(len(c.text) for c in effective_chunks)
    estimated_batches = max(1, math.ceil(total_chars / max_chars))

    start = time.monotonic()
    points: list[PointStruct] = []

    logger.info(
        "임베딩 시작 — 배치 간 %.0f초 대기, 동적 배치(상한 %d자), "
        "예상 배치: %d개, 잔여 텍스트: %d개 (start_chunk=%d)",
        batch_sleep, max_chars, estimated_batches, effective_total, start_chunk,
    )

    idx = 0
    batch_num = 0
    rate_limit_exhausted = False

    while idx < effective_total:
        # 배치 빌더: 글자 수 합계와 텍스트 수 모두 제한
        batch_chunks: list[Chunk] = []
        batch_chars = 0
        while idx < effective_total:
            chunk_len = len(effective_chunks[idx].text)
            if batch_chunks and (
                batch_chars + chunk_len > max_chars
                or len(batch_chunks) >= MAX_TEXTS_PER_BATCH
            ):
                break
            batch_chunks.append(effective_chunks[idx])
            batch_chars += chunk_len
            idx += 1

        batch_texts = [_build_text_for_embedding(c) for c in batch_chunks]
        abs_batch_end = start_chunk + idx
        batch_num += 1

        # Dense 임베딩 (429 시 3회 재시도, 소진 시 부분 완료)
        try:
            dense_vectors = _embed_batch_with_retry(batch_texts, title=title)
        except (genai_errors.ClientError, RuntimeError):
            logger.warning("임베딩 실패로 중단 — 여기까지 처리 후 부분 완료 처리")
            idx -= len(batch_chunks)  # 실패한 배치 롤백
            rate_limit_exhausted = True
            break

        # Sparse 임베딩 (로컬 CPU, API 호출 없음)
        sparse_results = embed_sparse_batch(batch_texts)

        for i, chunk in enumerate(batch_chunks):
            sparse_indices, sparse_values = sparse_results[i]
            chunk_key = f"{chunk.volume}:{chunk.chunk_index}"
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_key))
            if payload_sources is not None:
                source_list = payload_sources
            else:
                source_list = chunk.source if isinstance(chunk.source, list) else [chunk.source] if chunk.source else []
            points.append(
                PointStruct(
                    id=point_id,
                    vector={
                        "dense": dense_vectors[i],
                        "sparse": SparseVector(
                            indices=sparse_indices,
                            values=sparse_values,
                        ),
                    },
                    payload=QdrantChunkPayload(
                        text=chunk.text,
                        volume=chunk.volume,
                        chunk_index=chunk.chunk_index,
                        source=source_list,
                        title=chunk.title,
                        date=chunk.date,
                    ).model_dump(),
                )
            )

        # Qdrant upsert (충분히 쌓이면 flush)
        if len(points) >= _UPSERT_BATCH_SIZE:
            client.upsert(collection_name=collection_name, points=points)
            logger.info(
                "  [%d/%d] 청크 적재 중... (배치 %d: %d청크/%d자)",
                abs_batch_end, total, batch_num,
                len(batch_chunks), batch_chars,
            )
            points = []

            # 체크포인트 저장 (upsert 성공 후에만)
            if on_progress:
                on_progress(abs_batch_end)

        # RPM/TPM 방어: .env EMBED_BATCH_SLEEP 으로 제어
        time.sleep(batch_sleep)

    # 남은 points flush
    processed_count = idx
    if points:
        client.upsert(collection_name=collection_name, points=points)
        abs_flushed = start_chunk + processed_count
        logger.info("  [%d/%d] 청크 적재 완료", abs_flushed, total)
        if on_progress:
            on_progress(abs_flushed)

    elapsed = time.monotonic() - start
    is_partial = processed_count < effective_total
    logger.info(
        "인제스트 %s: %d/%d청크, %.1f초",
        "부분 완료 (API 한도)" if is_partial else "완료",
        processed_count, effective_total, elapsed,
    )
    return {
        "chunk_count": processed_count,
        "total_chunks": effective_total,
        "elapsed_sec": round(elapsed, 2),
        "is_partial": is_partial,
    }
