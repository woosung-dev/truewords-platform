"""audit 2차 R-4 + R-5 (2026-05-15) — lifespan shutdown finalize 회귀 잠금.

R-4: ``main.py`` lifespan 종료 후 ``engine.dispose()`` 호출 — Cloud Run revision
재시작 시 asyncpg pool 정리. 누락 시 idle connection leak.
R-5: ``common/database.get_background_session()`` dead code 제거. 호출처 0건 (grep
확인) — 보존 시 raw session 패턴 부활 위험.
"""

from __future__ import annotations

import inspect

from app import main
from app.core.common import database


def test_lifespan_calls_engine_dispose() -> None:
    """audit 2차 R-4: lifespan source 안에서 engine.dispose() 호출 명시.

    실제 lifespan 실행은 TestClient 통합 필요해 source 잠금 + import 검증으로 대체.
    """
    src = inspect.getsource(main.lifespan)
    assert "engine.dispose" in src, "audit 2차 R-4 — lifespan 이 engine.dispose 호출해야 함"


def test_lifespan_calls_shutdown_ingest_worker() -> None:
    """audit 2차 R-3 + R-4: lifespan finalize 에서 worker shutdown 호출."""
    src = inspect.getsource(main.lifespan)
    assert "shutdown_ingest_worker" in src, (
        "audit 2차 R-3 — lifespan 이 shutdown_ingest_worker 호출해야 함"
    )


def test_get_background_session_removed() -> None:
    """audit 2차 R-5: dead code 제거 — function 자체가 없어야 함."""
    assert not hasattr(database, "get_background_session"), (
        "audit 2차 R-5 — get_background_session dead code 가 다시 추가됨"
    )


def test_main_imports_engine_from_database() -> None:
    """app.main.py 가 database.engine 을 import — dispose 호출 정합성."""
    # main.py 모듈 안에 engine 심볼이 노출되어 있는지 확인
    assert hasattr(main, "engine")
