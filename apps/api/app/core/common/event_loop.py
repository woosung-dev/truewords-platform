"""FastAPI 메인 event loop 참조 — 백그라운드 워커가 DB 호출을 위임할 수 있도록.

audit 2차 B-3 (2026-05-15, Agent C P1 7/10): 기존 ``admin/ingest_service`` 가 worker
의 ``get_main_loop`` 를 import 하던 역방향 의존 (service → worker). 일반적으로
worker → service 가 정상. fix: main loop 참조 책임을 ``common/event_loop`` 로 이관.

AsyncEngine connection pool 은 단일 loop 에 바인딩되므로 워커 스레드가 직접 새
loop 로 접근하면 "attached to a different loop" 런타임 에러. lifespan 에서
``set_main_loop`` 으로 메인 loop 을 주입한 뒤 워커 스레드가 ``get_main_loop`` +
``run_coroutine_threadsafe`` 로 DB 호출을 위임.
"""

from __future__ import annotations

import asyncio

_main_loop: asyncio.AbstractEventLoop | None = None


def set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    """FastAPI lifespan 에서 호출. 메인 loop 을 워커가 쓸 수 있도록 저장."""
    global _main_loop
    _main_loop = loop


def get_main_loop() -> asyncio.AbstractEventLoop | None:
    """워커 스레드가 ``asyncio.run_coroutine_threadsafe`` 에 전달."""
    return _main_loop
