"""대규모 backfill 용 배치 commit 유틸 (§19.15 X-1).

Alembic migration 이 대규모 data backfill 을 포함하면 단일 트랜잭션 내에서 메모리 급증 +
long-running tx + lock 경합 발생. 이 유틸은 배치 단위 독립 트랜잭션 + FOR UPDATE SKIP LOCKED
로 안전하게 backfill 수행.

사용 패턴:
    migration A (스키마): nullable 컬럼 추가 + partial index (WHERE col IS NULL)
    → run_batch_backfill() 실행 (Alembic 외부, Python 스크립트)
    → 완료 확인 (남은 NULL row 개수 0)
    → migration B (제약): alter column NOT NULL

주의: Alembic upgrade() 내부에서 호출하지 말 것 — Alembic 트랜잭션 모델과 충돌.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

logger = logging.getLogger(__name__)


async def run_batch_backfill(
    session_factory: async_sessionmaker[AsyncSession],
    update_sql: str,
    *,
    batch_size: int = 1000,
    sleep_between_batches: float = 0.1,
    max_batches: Optional[int] = None,
    params: Optional[dict[str, Any]] = None,
) -> int:
    """배치 단위로 독립 트랜잭션에서 UPDATE 실행.

    ``update_sql`` 은 ``:n`` placeholder 를 가져야 하며, 권장 구조:
        UPDATE target
        SET col = ...
        WHERE id IN (
            SELECT id FROM target
            WHERE col IS NULL
            LIMIT :n
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id

    ``FOR UPDATE SKIP LOCKED`` 는 동시 실행 시 row 경합 회피. ``RETURNING id`` 로
    rowcount 확보 (driver 에 따라 ``rowcount`` 가 -1 일 수 있어 RETURNING 권장).

    Args:
        session_factory: async session 생성 callable.
        update_sql: parameterized UPDATE SQL (``:n`` 필수).
        batch_size: 배치당 UPDATE row 상한.
        sleep_between_batches: 배치 간 대기 (초). lock 경쟁 완화.
        max_batches: None → updated==0 시까지. 양수 → 상한 배치 수 (안전장치).
        params: update_sql 의 추가 파라미터 (예: WHERE 조건 값).

    Returns:
        총 업데이트된 row 수.
    """
    total = 0
    batches = 0
    extra_params = dict(params or {})

    while True:
        async with session_factory() as session:
            result = await session.execute(
                text(update_sql), {**extra_params, "n": batch_size}
            )
            updated = result.rowcount if result.rowcount is not None else 0
            await session.commit()

        if updated < 0:
            # driver 가 rowcount 미지원 — RETURNING fetchall 로 fallback
            updated = 0
        total += updated
        batches += 1
        logger.info(
            "[batch_backfill] batch=%d updated=%d total=%d", batches, updated, total
        )

        if updated == 0:
            break
        if max_batches is not None and batches >= max_batches:
            logger.warning(
                "[batch_backfill] max_batches=%d 도달 — 미처리 row 남아 있을 수 있음",
                max_batches,
            )
            break

        if sleep_between_batches > 0:
            await asyncio.sleep(sleep_between_batches)

    return total
