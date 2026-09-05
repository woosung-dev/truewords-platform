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

import logging
import queue
import threading
from pathlib import Path

# audit 2차 B-3 (2026-05-15): main loop 참조는 ``common/event_loop`` 으로 이관.
# 본 모듈은 back-compat re-export 만 유지. data_router 와 main.py 의 import chain
# 호환성 보존 (set_ingest_main_loop alias 등).
from app.core.common.event_loop import get_main_loop, set_main_loop  # noqa: F401

logger = logging.getLogger(__name__)

# 즉시 모드 업로드 워커 큐
_INGEST_QUEUE: "queue.Queue[tuple | None]" = queue.Queue(maxsize=100)
_WORKER_STARTED = threading.Event()
_WORKER_LOCK = threading.Lock()
_worker_thread: "threading.Thread | None" = None


def _ingest_worker() -> None:
    """즉시 모드 파일을 Queue 에서 하나씩 꺼내 처리하는 전용 워커."""
    # 순환 import 회피 — service 가 worker 의 get_main_loop 을 import 하므로 함수 안에서 lazy.
    from app.modules.admin.ingest_service import process_file_standard

    logger.info("[ingest-worker] 워커 시작")
    while True:
        try:
            task = _INGEST_QUEUE.get()
            if task is None:
                _INGEST_QUEUE.task_done()
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
    logger.info("[ingest-worker] 워커 종료")


def _ensure_worker() -> None:
    """워커 스레드가 없으면 시작 (멀티 요청에 안전).

    audit 2차 R-3 (2026-05-15, Codex E P1 8/10): 기존 ``daemon=True`` 는 Cloud Run
    SIGTERM 시 in-flight 처리 강제 중단 → IngestionJob RUNNING/PENDING stuck. fix:
    ``daemon=False`` + ``shutdown_worker()`` sentinel-based graceful shutdown.
    """
    global _worker_thread
    with _WORKER_LOCK:
        if not _WORKER_STARTED.is_set():
            _worker_thread = threading.Thread(
                target=_ingest_worker,
                name="ingest-worker",
                daemon=False,
            )
            _worker_thread.start()
            _WORKER_STARTED.set()


def shutdown_worker(timeout: float = 30.0) -> None:
    """audit 2차 R-3: lifespan shutdown 에서 호출 — sentinel + thread join.

    Cloud Run SIGTERM → lifespan finalization 단계에서 본 함수가 호출되어 worker
    queue 에 sentinel (None) 을 넣고 in-flight 처리 완료 + thread join 까지 대기.
    ``timeout`` 안에 종료 안 되면 thread 강제 회수 X (daemon=False) — 그러나 main
    process 가 곧 exit 되어 OS 가 회수 (Cloud Run grace period 10s 가정).

    Args:
        timeout: thread join 최대 대기 시간 (초). 기본 30 — 일반 ingest 1건 처리
                 시간 ~10초 가정 + 여유.
    """
    global _worker_thread
    with _WORKER_LOCK:
        if not _WORKER_STARTED.is_set() or _worker_thread is None:
            return
        thread_ref = _worker_thread
    # lock 풀고 sentinel + join — worker 가 다른 모듈에서 queue 호출 시 deadlock 방지.
    try:
        _INGEST_QUEUE.put_nowait(None)
    except queue.Full:
        # full 인 경우 in-flight + 100 wait. 첫 task 처리 완료 후 sentinel 받음.
        logger.warning("[ingest-worker] shutdown sentinel queue full — fallback put (blocking)")
        _INGEST_QUEUE.put(None)
    thread_ref.join(timeout=timeout)
    if thread_ref.is_alive():
        logger.warning("[ingest-worker] shutdown timeout %.1fs — thread 회수 미완", timeout)
    else:
        logger.info("[ingest-worker] shutdown 완료")


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
