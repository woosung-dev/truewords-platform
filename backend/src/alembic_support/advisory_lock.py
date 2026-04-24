"""Alembic advisory lock 로직 (§19.11 O-5 + §21.8 B4 PoC).

env.py 에서 optional 로 사용. 기본 OFF, 환경변수 `ALEMBIC_USE_ADVISORY_LOCK=true` 시에만 활성화.

토글 환경변수:
- `ALEMBIC_USE_ADVISORY_LOCK` — 활성화 (기본 false)
- `ALEMBIC_LOCK_KEY` — advisory lock key (기본 12345)
- `ALEMBIC_LOCK_TIMEOUT_SEC` — lock 획득 대기 (기본 300)
- `ALEMBIC_SKIP_IF_LOCKED` — timeout 시 skip 분기 진입 (기본 false)
- `ALEMBIC_EXPECTED_HEAD` — skip 허용 전 DB head 검증값
"""

from __future__ import annotations

import os
import time
from typing import Callable, Optional

from sqlalchemy import text
from sqlalchemy.engine import Connection

DEFAULT_LOCK_KEY = 12345
DEFAULT_TIMEOUT_SEC = 300


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def is_enabled() -> bool:
    return _bool_env("ALEMBIC_USE_ADVISORY_LOCK", default=False)


def _acquire(conn: Connection, key: int, timeout_sec: int) -> bool:
    """pg_try_advisory_lock 폴링. 성공 True, timeout False."""
    deadline = time.time() + timeout_sec
    while True:
        result = conn.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": key})
        if result.scalar():
            return True
        remaining = deadline - time.time()
        if remaining <= 0:
            return False
        time.sleep(min(2.0, max(0.1, remaining)))


def _release(conn: Connection, key: int) -> None:
    conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})


def _current_db_head(conn: Connection) -> Optional[str]:
    """alembic_version.version_num 조회. 테이블 미존재 시 None."""
    try:
        result = conn.execute(text("SELECT version_num FROM alembic_version"))
        row = result.first()
        return row[0] if row else None
    except Exception:
        return None


def _handle_miss(conn: Connection, timeout_sec: int) -> None:
    """Lock 획득 실패 시 skip 분기 or raise.

    - `ALEMBIC_SKIP_IF_LOCKED=false` (기본) → RuntimeError
    - `true` + `ALEMBIC_EXPECTED_HEAD` 미설정 → 경고 출력 후 skip (unsafe)
    - `true` + expected 설정 → DB head 비교, 일치 시 skip, 불일치 시 RuntimeError
    """
    if not _bool_env("ALEMBIC_SKIP_IF_LOCKED"):
        raise RuntimeError(
            f"Failed to acquire alembic advisory lock within {timeout_sec}s"
        )
    expected = os.getenv("ALEMBIC_EXPECTED_HEAD", "").strip()
    if not expected:
        print(
            "[alembic/lock] WARN: skipping without ALEMBIC_EXPECTED_HEAD "
            "— cannot verify DB state is up-to-date"
        )
        return
    current = _current_db_head(conn)
    if current != expected:
        raise RuntimeError(
            f"Cannot skip migration: DB head={current!r}, expected={expected!r}. "
            f"Another replica may be migrating. Retry after wait."
        )
    print(f"[alembic/lock] skipping (DB head matches expected={expected})")


def run_with_lock(conn: Connection, body: Callable[[Connection], None]) -> bool:
    """advisory lock 아래에서 body(conn) 실행.

    Returns:
        True — lock 획득 + body 실행 완료
        False — skip (ALEMBIC_SKIP_IF_LOCKED 분기, head 일치)
    Raises:
        RuntimeError — timeout 미스 + skip 비활성화 or expected_head 불일치
    """
    key = _int_env("ALEMBIC_LOCK_KEY", DEFAULT_LOCK_KEY)
    timeout_sec = _int_env("ALEMBIC_LOCK_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC)

    if not _acquire(conn, key, timeout_sec):
        _handle_miss(conn, timeout_sec)
        return False

    try:
        body(conn)
        return True
    finally:
        _release(conn, key)
