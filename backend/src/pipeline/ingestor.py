"""Qdrant 적재 — 배치 임베딩 + 청크 레벨 체크포인트 + RPD 방어.

청크 리스트를 받아 dense/sparse 임베딩 후 Qdrant에 upsert한다.
Google 무료 티어 RPD(1K/일) 제한을 카운터로 관리하며,
429 발생 시 지수 백오프(90→180초)로 재시도한다.
``--resume`` 을 통한 청크 레벨 체크포인트 재개를 지원한다.
"""

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
from src.pipeline.embedder import MAX_TEXTS_PER_BATCH, embed_dense_batch, embed_sparse_batch

if TYPE_CHECKING:
    from src.pipeline.progress import ProgressTracker

logger = logging.getLogger(__name__)

# Qdrant upsert 배치 크기
_UPSERT_BATCH_SIZE = 50


# ──────────────────────────────────────────────────────────────
# RPD (Requests Per Day) 방어 카운터
#
# 문제: 무료 등급 RPD 1K/일 — SDK 내부 retry + 코드 retry가 중복되면
#       실제 기대치보다 5배 이상 많은 요청이 발생, RPD 조기 소진.
#
# 해결:
#   1. embedder.py에서 SDK retry 중 429를 제외 (내부 retry 차단)
#   2. 여기서 RPD 카운터로 한도 근접 시 사전 중단
#   3. 배치 간 sleep으로 TPM/RPM 동시 제어
# ──────────────────────────────────────────────────────────────

# 무료: 1000 RPD, 안전 마진 5% → 950에서 중단
_RPD_LIMIT = getattr(settings, "embed_rpd_limit", 950)
_rpd_counter: int = 0
_rpd_reset_time: float = 0.0  # monotonic 시각 기준 다음 리셋 시점


def _get_rpd_count() -> int:
    """현재 세션의 누적 RPD 요청 수 반환 (24시간 경과 시 자동 리셋)."""
    global _rpd_counter, _rpd_reset_time
    now = time.monotonic()
    if now >= _rpd_reset_time:
        _rpd_counter = 0
        _rpd_reset_time = now + 86400  # 24시간 후 리셋
    return _rpd_counter


def _increment_rpd(text_count: int = 1) -> int:
    """RPD 카운터를 text_count만큼 증가 후 현재 값 반환.

    Google 무료 티어는 배치 API 호출 수가 아니라 개별 텍스트 수를 카운트한다.

    Args:
        text_count: 증가할 텍스트 수 (기본 1).

    Returns:
        증가 후 누적 RPD 카운트.
    """
    global _rpd_counter
    _get_rpd_count()  # 리셋 체크
    _rpd_counter += text_count
    return _rpd_counter


def _check_rpd_budget(needed: int) -> None:
    """RPD 예산 사전 검증 — 소진 시 ValueError, 부족 시 경고 후 계속 진행.

    Args:
        needed: 이번 인제스트에서 필요한 텍스트 수.

    Raises:
        ValueError: RPD 예산이 완전히 소진된 경우.
    """
    current = _get_rpd_count()
    remaining = _RPD_LIMIT - current
    if remaining <= 0:
        raise ValueError(
            f"RPD 예산 소진: 현재 {current}/{_RPD_LIMIT} 텍스트 사용. "
            f"내일 리셋 후 재시도하거나 유료 플랜으로 전환하세요."
        )
    if remaining < needed:
        logger.warning(
            "RPD 예산 부족: %d/%d 텍스트 사용 중, %d텍스트 필요하지만 %d만 가능. "
            "한도까지 처리 후 중단됩니다. --resume으로 내일 이어서 실행하세요.",
            current, _RPD_LIMIT, needed, remaining,
        )
    else:
        logger.info(
            "RPD 예산 확인: %d/%d 텍스트 사용 중, %d텍스트 추가 예정 → 잔여 %d",
            current, _RPD_LIMIT, needed, remaining - needed,
        )


def _embed_batch_with_retry(texts: list[str], title: str = "") -> list[list[float]]:
    """배치 dense 임베딩 + 429 지수 백오프 (90→180초, 최대 3회).

    SDK 내부 retry에서 429를 제외했으므로 여기서 직접 제어한다.
    성공 시 RPD 카운터를 텍스트 수만큼 증가시킨다.

    Args:
        texts: 임베딩할 텍스트 리스트.
        title: Gemini 임베딩 품질 향상용 문서 제목.

    Returns:
        각 텍스트에 대응하는 dense 벡터 리스트.

    Raises:
        google.genai.errors.ClientError: 429 외 API 에러 또는 3회 재시도 소진.
    """
    base_wait = getattr(settings, "retry_base_wait", 90.0)
    max_retries = 3

    for attempt in range(max_retries):
        try:
            result = embed_dense_batch(texts, title=title)
            _increment_rpd(len(texts))  # 텍스트 수 단위로 카운트
            return result
        except genai_errors.ClientError as e:
            if e.code != 429:
                raise

            current_rpd = _get_rpd_count()
            # Google API 원본 에러 메시지를 그대로 출력 (RPM/RPD/TPM 구분 포함)
            api_message = str(e)

            if attempt < max_retries - 1:
                wait = base_wait * (2 ** attempt)  # 90초, 180초
                logger.warning(
                    "Rate limit 429 — %.0f초 대기 (시도 %d/%d)\n"
                    "  RPD 누적: %d/%d\n"
                    "  API 원본 에러: %s",
                    wait, attempt + 1, max_retries,
                    current_rpd, _RPD_LIMIT,
                    api_message,
                )
                time.sleep(wait)
            else:
                logger.error(
                    "Rate limit 3회 연속 실패 — 파이프라인 중단.\n"
                    "  RPD 누적: %d/%d\n"
                    "  API 원본 에러: %s\n"
                    "  → 에러 메시지를 확인하여 RPM/RPD/TPM 중 어디에 걸렸는지 판단하세요.",
                    current_rpd, _RPD_LIMIT,
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
    tracker: ProgressTracker | None = None,
    volume_key: str = "",
) -> dict:
    """청크를 배치 임베딩 후 Qdrant에 upsert — 청크 레벨 체크포인트 지원.

    동적 배치(글자 수 기준)로 묶어 dense + sparse 임베딩을 수행하고,
    ``_UPSERT_BATCH_SIZE`` 단위로 Qdrant에 upsert한다.
    RPD 한도 도달 시 조기 중단되며, ``--resume``으로 이어서 실행 가능.

    Args:
        client: Qdrant 동기 클라이언트.
        collection_name: 적재 대상 Qdrant 컬렉션명.
        chunks: 적재할 Chunk 리스트.
        start_chunk: 재개 시작 인덱스 (0이면 처음부터).
        title: Gemini 임베딩 품질 향상용 문서 제목.
        tracker: 체크포인트 저장용 ProgressTracker (None이면 체크포인트 비활성).
        volume_key: tracker에 저장할 볼륨 키 (보통 파일명).

    Returns:
        ``{"chunk_count": int, "elapsed_sec": float}`` 형태 dict.
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

    # RPD 예산 사전 검증 — 부족하면 시작 전에 실패
    # Google 무료 RPD는 텍스트 수 단위 (배치 수가 아님)
    import math
    max_chars: int = settings.embed_max_chars_per_batch or 31000
    batch_sleep: float = settings.embed_batch_sleep or 60.0
    _check_rpd_budget(effective_total)  # 텍스트 수로 예산 검증
    total_chars = sum(len(c.text) for c in effective_chunks)
    estimated_batches = max(1, math.ceil(total_chars / max_chars))

    start = time.monotonic()
    points: list[PointStruct] = []

    logger.info(
        "임베딩 시작 — RPD: %d/%d 텍스트, 배치 간 %.0f초 대기, "
        "동적 배치(상한 %d자), 예상 배치: %d개, 잔여 텍스트: %d개",
        _get_rpd_count(), _RPD_LIMIT, batch_sleep,
        max_chars, estimated_batches, effective_total,
    )

    # 동적 배치: 글자 수 합계가 max_chars를 넘지 않도록 청크를 묶음
    # 짧은 청크 → 배치 크기 ↑ (최대 MAX_TEXTS_PER_BATCH)
    # 긴 청크 → 배치 크기 ↓ (TPM 초과 방지)
    idx = 0
    batch_num = 0
    while idx < effective_total:
        # RPD 한도 도달 시 조기 중단 (가능한 만큼 처리 후 멈춤)
        current_rpd = _get_rpd_count()
        if current_rpd >= _RPD_LIMIT:
            logger.warning(
                "RPD 한도 도달 (%d/%d 텍스트). 여기까지 처리 후 중단. "
                "--resume으로 내일 이어서 실행하세요.",
                current_rpd, _RPD_LIMIT,
            )
            break

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

        batch_texts = [c.text for c in batch_chunks]
        abs_batch_end = start_chunk + idx
        batch_num += 1

        # Dense 임베딩 (1회 API 호출, title 포함)
        dense_vectors = _embed_batch_with_retry(batch_texts, title=title)

        # Sparse 임베딩 (로컬 CPU, API 호출 없음)
        sparse_results = embed_sparse_batch(batch_texts)

        for i, chunk in enumerate(batch_chunks):
            sparse_indices, sparse_values = sparse_results[i]
            # 결정적 ID: volume + chunk_index 기반 UUID5
            # source는 다중 카테고리 지원으로 배열이 되므로 ID에서 제외
            # → 동일 문서의 동일 청크는 항상 같은 ID (idempotent)
            chunk_key = f"{chunk.volume}:{chunk.chunk_index}"
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_key))
            # source를 배열로 저장 (다중 카테고리 지원)
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
                    payload={
                        "text": chunk.text,
                        "volume": chunk.volume,
                        "chunk_index": chunk.chunk_index,
                        "source": source_list,
                        "title": chunk.title,
                        "date": chunk.date,
                    },
                )
            )

        # Qdrant upsert (충분히 쌓이면 flush)
        if len(points) >= _UPSERT_BATCH_SIZE:
            client.upsert(collection_name=collection_name, points=points)
            rpd_now = _get_rpd_count()
            logger.info(
                "  [%d/%d] 청크 적재 중... (배치 %d: %d청크/%d자, RPD: %d/%d)",
                abs_batch_end, total, batch_num,
                len(batch_chunks), batch_chars, rpd_now, _RPD_LIMIT,
            )
            points = []

            # 체크포인트 저장 (upsert 성공 후에만)
            if tracker and volume_key:
                tracker.mark_chunk_progress(volume_key, abs_batch_end, total)

        # RPM/TPM 방어: .env EMBED_BATCH_SLEEP 으로 제어
        # 무료(TPM 30K): 60초 (TPM 윈도우 리셋 대기)
        # 유료(TPM 1M): 3초
        time.sleep(batch_sleep)

    # 남은 points flush
    if points:
        client.upsert(collection_name=collection_name, points=points)
        logger.info("  [%d/%d] 청크 적재 완료", total, total)
        if tracker and volume_key:
            tracker.mark_chunk_progress(volume_key, total, total)

    elapsed = time.monotonic() - start
    rpd_final = _get_rpd_count()
    logger.info(
        "인제스트 완료: %d청크, %.1f초, RPD 누적: %d/%d",
        effective_total, elapsed, rpd_final, _RPD_LIMIT,
    )
    return {"chunk_count": effective_total, "elapsed_sec": round(elapsed, 2)}
