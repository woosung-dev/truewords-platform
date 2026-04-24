"""대규모 backfill 템플릿 (§19.15 X-1).

실제 운영 backfill 시 이 템플릿을 복사해 SQL/조건을 교체. Alembic migration 외부에서
별도 단계로 실행:

    1. alembic upgrade head                        # nullable 컬럼 + partial index 추가
    2. python backend/scripts/backfill_sample.py   # 본 스크립트 (혹은 복사본)
    3. 완료 확인 (남은 NULL row 수 0)
    4. 다음 alembic revision 으로 NOT NULL 제약 전환

TEMPLATE: 실제 사용 시 `SAMPLE_UPDATE_SQL` 및 필요한 파라미터만 교체.
"""

from __future__ import annotations

import asyncio
import logging
import sys

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.alembic_support.batch_backfill import run_batch_backfill
from src.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")


# ── 실제 backfill 시 이 SQL 을 교체. LIMIT :n / FOR UPDATE SKIP LOCKED / RETURNING id 유지.
SAMPLE_UPDATE_SQL = """
UPDATE sample_target
SET computed_value = source_column::TEXT
WHERE id IN (
    SELECT id FROM sample_target
    WHERE computed_value IS NULL
    LIMIT :n
    FOR UPDATE SKIP LOCKED
)
RETURNING id
"""


async def main() -> int:
    engine = create_async_engine(settings.database_url.get_secret_value())
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        total = await run_batch_backfill(
            session_factory,
            SAMPLE_UPDATE_SQL,
            batch_size=1000,
            sleep_between_batches=0.1,
        )
        logging.info("Backfill complete. total updated=%d", total)
    finally:
        await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
