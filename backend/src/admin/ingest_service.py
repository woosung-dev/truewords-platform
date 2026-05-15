# 즉시 모드 파일 처리 service — 텍스트 추출 + 청킹 + 임베딩 + Qdrant 적재. audit P0-8 fix.
"""Ingestion service — 단일 파일 standard 처리.

audit P0-8 (2026-05-15): 기존 `data_router.py` 안의 비즈니스 로직 (텍스트 추출 →
청킹 → 임베딩 → Qdrant 적재) 을 worker 모듈과 분리. router 는 HTTP endpoint 만,
worker 는 queue/thread 만, service 는 처리 본체.

ADR-30 follow-up 정책 (merge / replace / skip) + content_hash 기반 skip 단축 +
COMPLETED 재업로드 reset 모두 본 모듈의 `_resolve_upload_strategy` + `_process_
file_standard` 가 결정/실행한다.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import unicodedata
from pathlib import Path

from src.admin.ingest_worker import get_main_loop
from src.common.database import async_session_factory
from src.config import settings
from src.datasource.dependencies import get_qdrant_service
from src.pipeline.chunker import chunk_recursive
from src.pipeline.extractor import extract_text
from src.pipeline.ingestion_repository import IngestionJobRepository
from src.pipeline.ingestor import ingest_chunks
from src.pipeline.metadata import classify_book_series, extract_metadata

logger = logging.getLogger(__name__)


def _compute_content_hash(text: str) -> str:
    """추출된 원본 텍스트의 SHA-256 hex digest.

    skip 모드(ADR-30 follow-up)에서 동일 파일명이라도 콘텐츠가 변경되었는지
    판단하는 진실 원점. UTF-8 인코딩의 raw 바이트 기반 — NFC/NFD 정규화 여부는
    호출자가 결정.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _resolve_upload_strategy(
    *,
    on_duplicate: str,
    existing_status: str | None,
    existing_processed_chunks: int,
    existing_total_chunks: int,
    existing_content_hash: str | None,
    existing_chunk_count: int,
    existing_sources: list[str],
    new_source: str,
    new_hash: str,
) -> dict:
    """ADR-30 재업로드 정책의 분기 결정을 한 번에 계산하는 순수 함수.

    ``_process_file_standard``에서 IO/임베딩과 분리해 호출함으로써 Codex P1/P2
    수정사항(reset / total_chunks 보존 / skip 단축 / payload union)을 mock 없는
    단위 테스트로 잠글 수 있다.

    Returns:
        dict with:
          - skip_short_circuit (bool): True면 임베딩 건너뛰고 complete_job 복구.
          - needs_reset (bool): True면 Qdrant 청크 삭제 + start_chunk=0.
          - payload_sources (list[str] | None): ingest_chunks에 전달할 source 리스트.
              None이면 chunk.source([source])를 그대로 사용.
          - preserved_processed (int): skip 단축 시 복구할 processed_chunks.
          - preserved_total (int): skip 단축 시 복구할 total_chunks.
    """
    is_completed = existing_status == "completed"

    # skip + COMPLETED + processed > 0 + hash 일치 → 임베딩 건너뜀.
    skip_short_circuit = (
        on_duplicate == "skip"
        and is_completed
        and existing_processed_chunks > 0
        and existing_content_hash is not None
        and existing_content_hash == new_hash
    )
    if skip_short_circuit:
        preserved_processed = existing_processed_chunks
        preserved_total = existing_total_chunks or preserved_processed
        return {
            "skip_short_circuit": True,
            "needs_reset": False,
            "payload_sources": None,
            "preserved_processed": preserved_processed,
            "preserved_total": preserved_total,
        }

    # COMPLETED + Qdrant chunks > 0 → reset (기존 청크 삭제 후 0부터 적재).
    # PARTIAL/RUNNING은 재개 의도라 reset하지 않는다.
    needs_reset = is_completed and existing_chunk_count > 0

    # payload_sources 정책:
    # - merge: 기존 ∪ 신규 (existing_sources는 reset 직전 스냅샷)
    # - skip(여기 도달 = hash 불일치 fallback): merge와 동일 정책으로 분류 보존
    # - replace: None → ingest_chunks가 chunk.source([source])를 그대로 사용
    payload_sources: list[str] | None = None
    if on_duplicate in ("merge", "skip"):
        union = {s for s in existing_sources if s}
        if new_source:
            union.add(new_source)
        payload_sources = sorted(union) if union else None

    return {
        "skip_short_circuit": False,
        "needs_reset": needs_reset,
        "payload_sources": payload_sources,
        "preserved_processed": 0,
        "preserved_total": 0,
    }


def _predict_outcome(
    on_duplicate: str,
    existing_status: str | None,
    existing_chunk_count: int,
) -> str:
    """ADR-30 follow-up: 업로드 시점에 처리 예상 동작을 노출 (UI 토스트용).

    실제 처리는 background에서 일어나며, skip은 hash가 다르면 merge로 fallback.
    여기서는 가장 가능성 높은 outcome을 반환한다.
    """
    exists = existing_status is not None or existing_chunk_count > 0
    if not exists:
        return "new"
    if on_duplicate == "skip" and existing_status == "completed":
        return "skip"
    if on_duplicate == "replace":
        return "replace"
    return "merge"


async def _get_existing_snapshot(volume_key: str) -> tuple[list[str], int]:
    """기존 volume의 (sources, chunk_count) 조회 — 워커가 메인 loop에 위임해 사용.

    audit P1-4 fix (2026-05-15): Depends 우회 컨텍스트지만 service 인스턴스화는
    `datasource/dependencies.get_qdrant_service` factory 를 호출해 일원화한다.
    NFC/NFD 혼재 대응은 서비스 메서드 내부에서 처리한다.
    """
    svc = await get_qdrant_service()
    return await svc.get_volume_snapshot(volume_key)


def process_file_standard(
    file_path: Path,
    filename: str,
    source: str,
    on_duplicate: str = "merge",
) -> None:
    """즉시 모드: 전용 워커에서 호출. 청크 추출 → 임베딩 → Qdrant 적재.

    DB 호출은 FastAPI 메인 loop에 위임 (run_coroutine_threadsafe)하여
    AsyncEngine connection pool의 단일 loop 바인딩 제약을 준수한다.

    on_duplicate (ADR-30):
      - merge   : 기존 payload.source ∪ 신규 source 로 union (default).
      - replace : 신규 source 로 통째로 교체 (기존 동작).
      - skip    : 동일 파일이 COMPLETED 상태면 임베딩/upsert 모두 건너뜀.
    """
    volume_key = unicodedata.normalize("NFC", filename)

    loop = get_main_loop()
    if loop is None:
        logger.error("[%s] 메인 loop 미설정 — 워커 실행 불가 (lifespan 초기화 확인)", volume_key)
        return

    def run_repo(fn):
        """Repository 작업을 메인 loop에 제출하고 결과를 blocking으로 받는다."""
        async def _exec():
            async with async_session_factory() as session:
                repo = IngestionJobRepository(session)
                result = await fn(repo)
                await repo.commit()
                return result
        future = asyncio.run_coroutine_threadsafe(_exec(), loop)
        return future.result()

    def run_async(coro):
        """임의 코루틴을 메인 loop에 제출하고 결과를 blocking으로 받는다."""
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        return future.result()

    try:
        # ADR-30 follow-up: 모든 모드에서 기존 job을 먼저 조회 (skip 단축 + reset 판단용)
        existing_job = run_repo(lambda r: r.get_by_volume_key(volume_key))

        run_repo(lambda r: r.upsert_pending(volume_key, filename, source))

        logger.info(
            "[%s] 처리 시작 (file_path=%s, on_duplicate=%s)",
            volume_key, file_path, on_duplicate,
        )

        # 1. 텍스트 추출
        text = extract_text(file_path)
        logger.info("[%s] 텍스트 추출 완료 (%d자)", volume_key, len(text))
        if not text.strip():
            run_repo(lambda r: r.fail_job(volume_key, "빈 파일"))
            return

        new_hash = _compute_content_hash(text)

        # 2. 메타데이터 + volume 정규화 (NFC) — _get_existing_snapshot도 같은 키로 조회한다.
        meta = extract_metadata(file_path, text)
        volume = unicodedata.normalize("NFC", meta["volume"] or volume_key)

        # 3. ADR-30 정책 분기 — Qdrant 스냅샷(reset 직전) + helper로 결정.
        existing_sources, existing_chunk_count = run_async(_get_existing_snapshot(volume))
        strategy = _resolve_upload_strategy(
            on_duplicate=on_duplicate,
            existing_status=existing_job.status.value if existing_job else None,
            existing_processed_chunks=existing_job.processed_chunks if existing_job else 0,
            existing_total_chunks=existing_job.total_chunks if existing_job else 0,
            existing_content_hash=existing_job.content_hash if existing_job else None,
            existing_chunk_count=existing_chunk_count,
            existing_sources=existing_sources,
            new_source=source,
            new_hash=new_hash,
        )

        # 4. skip 단축 — 임베딩/upsert 생략 + COMPLETED + total_chunks 복구 (Codex P2).
        if strategy["skip_short_circuit"]:
            preserved_processed = strategy["preserved_processed"]
            preserved_total = strategy["preserved_total"]
            logger.info(
                "[%s] skip + COMPLETED + content_hash 일치(%d/%d청크) → 임베딩 생략 (Gemini 호출 0회)",
                volume_key, preserved_processed, preserved_total,
            )
            run_repo(
                lambda r: r.complete_job(
                    volume_key, preserved_processed, total_chunks=preserved_total
                )
            )
            run_repo(lambda r: r.update_content_hash(volume_key, new_hash))
            return

        # 5. 문서 청킹 — Phase 2.4 운영 기본 (dev-log 51) Recursive 700/150
        # + Phase 3 dev-log 53 권고 — book_series 자동 분류
        book_series = classify_book_series(file_path)
        chunks = chunk_recursive(text, volume=volume, source=source,
                                 title=meta["title"], date=meta["date"])
        if book_series:
            for c in chunks:
                c.book_series = book_series
        logger.info(
            "[%s] 청킹 완료 (%d개 청크, recursive, book_series=%r)",
            volume_key, len(chunks), book_series,
        )

        # 6. ADR-30 P1: COMPLETED 재업로드는 reset 후 0부터 적재. start_chunk 자동 재개를
        #    그대로 두면 같은 길이 재업로드 시 effective_chunks=[]로 빠져 silent no-op 발생.
        if strategy["needs_reset"]:
            from src.pipeline.ingestor import _sync_delete_by_filter

            _sync_delete_by_filter(
                settings.collection_name,
                {"must": [{"key": "volume", "match": {"value": volume}}]},
            )
            logger.info(
                "[%s] 재업로드 reset: 기존 %d청크 삭제 + start_chunk=0 (on_duplicate=%s)",
                volume_key, existing_chunk_count, on_duplicate,
            )
            start_chunk = 0
        else:
            start_chunk = existing_chunk_count
            if start_chunk > 0:
                logger.info(
                    "[%s] Qdrant %d청크 확인 → %d번부터 재개 (총 %d청크)",
                    volume_key, start_chunk, start_chunk, len(chunks),
                )

        # 7. RUNNING 상태 + total_chunks 저장
        run_repo(lambda r: r.start_run(volume_key, total_chunks=len(chunks)))
        if start_chunk > 0:
            run_repo(lambda r: r.update_progress(volume_key, start_chunk))

        # 7-bis. content_hash 즉시 저장 — Root cause fix (PR #99).
        # start_run 직후 저장하면 모든 상태에서 hash 보존, 재개 시 자동 일치 확인 가능.
        run_repo(lambda r: r.update_content_hash(volume_key, new_hash))

        # 8. payload_sources는 strategy가 결정 (merge/skip union or None)
        payload_sources = strategy["payload_sources"]
        if payload_sources is not None:
            logger.info(
                "[%s] %s 정책: 기존 source=%s + 신규 '%s' → 적재 source=%s",
                volume_key, on_duplicate, existing_sources, source, payload_sources,
            )

        # 9. 임베딩 + 적재 (upsert마다 on_progress 콜백으로 DB 갱신)
        def on_progress(abs_processed: int):
            run_repo(lambda r: r.update_progress(volume_key, abs_processed))

        stats = ingest_chunks(
            settings.collection_name, chunks,
            start_chunk=start_chunk, title=meta["title"],
            on_progress=on_progress,
            payload_sources=payload_sources,
        )

        # 10. 최종 상태 전이
        final_processed = start_chunk + stats["chunk_count"]
        if stats.get("is_partial"):
            logger.warning(
                "[%s] 부분 적재 (%d/%d청크, %.1f초) — 재업로드로 이어서 처리 가능",
                volume_key, stats["chunk_count"], stats["total_chunks"], stats["elapsed_sec"],
            )
            run_repo(lambda r: r.mark_partial(volume_key, final_processed))
        else:
            logger.info("[%s] 적재 완료 (%d청크, %.1f초)",
                        volume_key, stats["chunk_count"], stats["elapsed_sec"])
            run_repo(
                lambda r: r.complete_job(
                    volume_key, len(chunks), total_chunks=len(chunks)
                )
            )
            run_repo(lambda r: r.update_content_hash(volume_key, new_hash))

    except Exception as e:
        logger.exception("[%s] 처리 실패", volume_key)
        try:
            run_repo(lambda r: r.fail_job(volume_key, str(e)))
        except Exception:
            logger.exception("[%s] 실패 상태 기록도 실패", volume_key)
    finally:
        if file_path.exists():
            file_path.unlink()
