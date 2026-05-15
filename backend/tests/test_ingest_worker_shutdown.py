"""audit 2차 R-3 (2026-05-15) — ingest_worker graceful shutdown 회귀 잠금.

기존 ``daemon=True`` thread + lifespan shutdown 처리 없음 → Cloud Run SIGTERM 시
in-flight 처리 강제 중단, IngestionJob RUNNING/PENDING stuck. fix: ``daemon=False``
+ ``shutdown_worker()`` sentinel + thread join.
"""

from __future__ import annotations

import inspect
import threading
import time

from src.admin import ingest_worker


def test_worker_thread_is_not_daemon() -> None:
    """audit 2차 R-3: worker thread 가 daemon=False 인지 ``_ensure_worker`` source 잠금."""
    src = inspect.getsource(ingest_worker._ensure_worker)
    assert "daemon=False" in src, "audit 2차 R-3 — worker thread 가 daemon=False 여야 함"


def test_shutdown_worker_exists_and_is_callable() -> None:
    """audit 2차 R-3: shutdown_worker public 함수 노출."""
    assert hasattr(ingest_worker, "shutdown_worker")
    assert callable(ingest_worker.shutdown_worker)


def test_shutdown_worker_noop_when_worker_not_started() -> None:
    """worker 가 한 번도 시작 안 됐을 때 shutdown 호출은 noop — 부작용 X."""
    # 클린 상태 보장 (다른 테스트 영향 격리)
    ingest_worker._WORKER_STARTED.clear()
    ingest_worker._worker_thread = None
    # 어떤 예외도 raise 안 해야 함
    ingest_worker.shutdown_worker(timeout=0.1)


def test_shutdown_worker_sends_sentinel_and_joins() -> None:
    """worker 시작 후 shutdown_worker → sentinel + thread join 완료.

    실제 _ingest_worker 는 ingest_service import 가 무거워 fake 로 대체.
    """
    # 기존 상태 초기화
    ingest_worker._WORKER_STARTED.clear()
    ingest_worker._worker_thread = None
    while not ingest_worker._INGEST_QUEUE.empty():
        ingest_worker._INGEST_QUEUE.get_nowait()

    # fake worker — sentinel 받으면 종료
    def _fake_worker() -> None:
        while True:
            task = ingest_worker._INGEST_QUEUE.get()
            ingest_worker._INGEST_QUEUE.task_done()
            if task is None:
                break

    fake_thread = threading.Thread(target=_fake_worker, daemon=False)
    fake_thread.start()
    ingest_worker._worker_thread = fake_thread
    ingest_worker._WORKER_STARTED.set()

    # shutdown 호출 → sentinel put + join
    start = time.monotonic()
    ingest_worker.shutdown_worker(timeout=5.0)
    elapsed = time.monotonic() - start

    assert not fake_thread.is_alive(), "shutdown 후 thread alive 면 sentinel/join 실패"
    assert elapsed < 5.0, "shutdown 이 timeout 안에 완료 안 됨"

    # cleanup
    ingest_worker._WORKER_STARTED.clear()
    ingest_worker._worker_thread = None
