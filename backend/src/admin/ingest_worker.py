# 즉시 모드 적재 워커 — Queue + 전용 스레드. audit P0-8 fix — data_router 866L 분할.
"""Ingestion worker — TPM 한도 준수 + 스레드 풀 보호용 단일 워커.

audit P0-8 (2026-05-15): 기존 `data_router.py` 안의 worker queue/thread state +
worker thread + DI 우회 helper 들이 모두 raw HTTP endpoint 파일에 섞여 있어
파일이 866 줄로 커졌다. 본 모듈은 워커 라이프사이클 + queue + main loop 참조만
담당. 실제 파일 처리 (extract → chunk → embed → ingest) 는 `ingest_service.py`.

FastAPI BackgroundTasks 는 병렬 실행되어 Semaphore 로 직렬화하면 대기 태스크가
스레드 풀을 점유해 HTTP 응답이 느려진다. 대신 Queue + 전용 워커 1개로 처리한다.
AsyncEngine connection pool 은 단일 loop 바인딩이므로 워커 스레드가 메인 loop
참조를 통해 DB 호출을 위임한다 (`get_main_loop()` 노출).
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# 즉시 모드 업로드 워커 큐
_INGEST_QUEUE: "queue.Queue[tuple]" = queue.Queue(maxsize=100)
_WORKER_STARTED = threading.Event()
_WORKER_LOCK = threading.Lock()

# FastAPI 메인 event loop 참조 — 워커 스레드가 DB 호출을 메인 loop 에 위임한다.
# AsyncEngine 의 connection pool 은 단일 loop 에 바인딩되므로 워커가 직접 새 loop
# 로 접근하면 "attached to a different loop" 런타임 에러 발생. lifespan 에서 주입.
_main_loop: "asyncio.AbstractEventLoop | None" = None


def set_main_loop(loop: "asyncio.AbstractEventLoop") -> None:
    """FastAPI lifespan 에서 호출. 메인 loop 을 워커가 쓸 수 있도록 저장."""
    global _main_loop
    _main_loop = loop


def get_main_loop() -> "asyncio.AbstractEventLoop | None":
    """ingest_service 의 process_file_standard 가 `run_coroutine_threadsafe` 에 사용."""
    return _main_loop


def _ingest_worker() -> None:
    """즉시 모드 파일을 Queue 에서 하나씩 꺼내 처리하는 전용 워커."""
    # 순환 import 회피 — service 가 worker 의 get_main_loop 을 import 하므로 함수 안에서 lazy.
    from src.admin.ingest_service import process_file_standard

    logger.info("[ingest-worker] 워커 시작")
    while True:
        try:
            task = _INGEST_QUEUE.get()
            if task is None:
                break
            file_path, filename, source, on_duplicate = task
            try:
                process_file_standard(file_path, filename, source, on_duplicate)
            except Exception:
                logger.exception("[ingest-worker] 처리 중 예외")
            finally:
                _INGEST_QUEUE.task_done()
        except Exception:
            logger.exception("[ingest-worker] 워커 루프 예외")


def _ensure_worker() -> None:
    """워커 스레드가 없으면 시작 (멀티 요청에 안전)."""
    with _WORKER_LOCK:
        if not _WORKER_STARTED.is_set():
            t = threading.Thread(target=_ingest_worker, name="ingest-worker", daemon=True)
            t.start()
            _WORKER_STARTED.set()


def enqueue_file_ingestion(
    file_path: Path,
    filename: str,
    source: str,
    mode: str = "standard",
    on_duplicate: str = "merge",
) -> None:
    """BackgroundTask 진입점. standard 워커 큐에 투입.

    ADR-30 follow-up: on_duplicate 정책 (merge/replace/skip) 적용. Batch API 모드는
    polling 인프라 미완성으로 제거됨 (PR #95). standard 즉시 처리만 지원.
    """
    _ = mode  # 호환성 유지 — 인자 보존, 항상 standard 동작
    _ensure_worker()
    _INGEST_QUEUE.put((file_path, filename, source, on_duplicate))
    logger.info(
        "[%s] 처리 큐에 투입 (대기열 %d개, on_duplicate=%s)",
        filename, _INGEST_QUEUE.qsize(), on_duplicate,
    )
