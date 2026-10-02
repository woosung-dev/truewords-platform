"""DB 타임스탬프 aware UTC 규약 회귀 — naive 값은 바인딩에서 거부되고 utcnow() 는 aware 다."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy.exc import StatementError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.common.clock import utcnow
from app.modules.identity.models import User


def test_utcnow_is_aware_utc():
    assert utcnow().utcoffset() == timedelta(0)


async def test_naive_datetime_is_rejected_on_flush():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(User.__table__.create)
    async with AsyncSession(engine) as session:
        session.add(User(email="naive@example.com", password_hash="x", display_name="n", created_at=datetime(2026, 10, 1)))
        with pytest.raises(StatementError) as caught:
            await session.flush()
    assert isinstance(caught.value.orig, ValueError)
    await engine.dispose()
