"""Alembic advisory lock + expected-head skip + rollback 호환 로직.

§19.11 O-5 + §21.8 B4 + §22.7 N4 PoC. env.py 에서 optional 로 사용.
기본 OFF, 환경변수 `ALEMBIC_USE_ADVISORY_LOCK=true` 시에만 활성화.

토글 환경변수:
- `ALEMBIC_USE_ADVISORY_LOCK` — 활성화 (기본 false)
- `ALEMBIC_LOCK_KEY` — advisory lock key (기본 12345)
- `ALEMBIC_LOCK_TIMEOUT_SEC` — lock 획득 대기 (기본 300)
- `ALEMBIC_SKIP_IF_LOCKED` — timeout 시 skip 분기 진입 (기본 false)
- `ALEMBIC_EXPECTED_HEAD` — skip 허용 전 DB head 검증값 (env 미설정 시 빌드 artifact 파일 fallback)

§22.7 N4 — Dockerfile 빌드 단계에서 `alembic heads | awk '{print $1}' > /app/ALEMBIC_EXPECTED_HEAD`
로 expected head 를 빌드 artifact 로 고정. env 미설정 시 이 파일에서 읽음. 또한 skip 분기에서
`expected == current` 뿐 아니라 `expected` 가 `current` 의 조상(rollback 시나리오)인 경우도 허용.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable, Optional

from sqlalchemy import text
from sqlalchemy.engine import Connection

DEFAULT_LOCK_KEY = 12345
DEFAULT_TIMEOUT_SEC = 300
DEFAULT_EXPECTED_HEAD_FILES = (
    "/app/ALEMBIC_EXPECTED_HEAD",
    "ALEMBIC_EXPECTED_HEAD",
)


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


def _expected_head() -> str:
    """ALEMBIC_EXPECTED_HEAD env → 빌드 artifact 파일 순으로 탐색. 없으면 빈 문자열."""
    env_value = os.getenv("ALEMBIC_EXPECTED_HEAD", "").strip()
    if env_value:
        return env_value
    for path in DEFAULT_EXPECTED_HEAD_FILES:
        p = Path(path)
        if p.is_file():
            try:
                value = p.read_text().strip().split()[0] if p.read_text().strip() else ""
                if value:
                    return value
            except Exception:
                continue
    return ""


def _is_ancestor(expected: str, current: str, script_location: str = "alembic") -> bool:
    """`expected` 가 `current` 의 조상(또는 같음) 이면 True.

    rollback 시나리오 호환: 신 DB(current) 가 구 image(expected) 보다 앞서 있을 때,
    expected 가 current 의 조상이면 구 image 코드가 동작 가능. 그 migration 이 추가한
    컬럼/테이블을 구 image 가 사용하지 않는다는 전제.
    """
    if not expected or not current:
        return False
    if expected == current:
        return True
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        cfg = Config()
        cfg.set_main_option("script_location", script_location)
        script = ScriptDirectory.from_config(cfg)
        # walk_revisions(base, head) — base 가 head 의 조상이 아니면 CommandError
        list(script.walk_revisions(base=expected, head=current))
        return True
    except Exception:
        return False


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

    skip 분기(`ALEMBIC_SKIP_IF_LOCKED=true`) 내부 단계:
    1. `ALEMBIC_EXPECTED_HEAD` (env 또는 빌드 artifact) 미설정 → WARN + skip (unsafe)
    2. `current == expected` → skip (정상)
    3. `expected` 가 `current` 의 조상 → skip (§22.7 N4 rollback 호환)
    4. 그 외 → RuntimeError
    """
    if not _bool_env("ALEMBIC_SKIP_IF_LOCKED"):
        raise RuntimeError(
            f"Failed to acquire alembic advisory lock within {timeout_sec}s"
        )

    expected = _expected_head()
    if not expected:
        print(
            "[alembic/lock] WARN: skipping without ALEMBIC_EXPECTED_HEAD "
            "— cannot verify DB state is up-to-date"
        )
        return

    current = _current_db_head(conn)

    if current == expected:
        print(f"[alembic/lock] skipping (DB head matches expected={expected})")
        return

    if current and _is_ancestor(expected, current):
        print(
            f"[alembic/lock] skipping (DB head={current} ahead of expected={expected}, "
            f"expected is ancestor — rollback-compatible)"
        )
        return

    raise RuntimeError(
        f"Cannot skip migration: DB head={current!r}, expected={expected!r}. "
        f"Another replica may be migrating or DB/image version mismatch. Retry after wait."
    )


def run_with_lock(conn: Connection, body: Callable[[Connection], None]) -> bool:
    """advisory lock 아래에서 body(conn) 실행.

    Returns:
        True — lock 획득 + body 실행 완료
        False — skip (ALEMBIC_SKIP_IF_LOCKED 분기, head 일치 또는 ancestor)
    Raises:
        RuntimeError — timeout 미스 + skip 비활성화 or expected_head 불일치 or 무관
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
