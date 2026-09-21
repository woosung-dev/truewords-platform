"""실제 PostgreSQL 행 잠금 회귀. JOURNEY_TEST_DATABASE_URL의 격리 DB에서만 실행한다.

각 테스트는 고유 사용자·기간·권리만 생성하고 정리한다. 기존 시드와 운영 코퍼스는 사용하지 않는다.
"""

import asyncio
import os
import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, func, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import select

from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.models import (
    ClientErrorEvent,
    ContentRight,
    JeongseongPeriod,
    JeongseongReading,
)
from app.modules.hoondok.repository import JeongseongRepository
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.service import IdentityService
from app.modules.search.hybrid import SearchResult

DATABASE_URL = os.environ.get("JOURNEY_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="격리 PostgreSQL 명시 URL 필요"
)
DAY = date(2026, 9, 21)
BODY = "감사하는 마음으로 하루를 시작하고 서로를 존중하며 작은 일에서도 사랑을 실천하는 삶을 살아가야 합니다."
OTHER_BODY = "이웃의 어려움을 먼저 살피고 가족에게 따뜻한 말을 건네며 언제나 작은 약속을 소중하게 지키는 삶을 살아가야 합니다."


@pytest.fixture
async def pg():
    assert DATABASE_URL and DATABASE_URL.startswith("postgresql+asyncpg://")
    engine = create_async_engine(DATABASE_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, period_id = uuid.uuid4(), uuid.uuid4()
    volume = f"concurrency-{uuid.uuid4()}"
    async with factory() as session:
        session.add(
            User(
                id=user_id,
                email=f"{user_id}@example.com",
                password_hash="test",
                display_name="경합 검증",
            )
        )
        await session.flush()
        session.add(
            JeongseongPeriod(
                id=period_id,
                user_id=user_id,
                topic="감사",
                duration_days=7,
                started_on=DAY,
            )
        )
        session.add(
            ContentRight(
                volume=volume,
                work_title="경합 검증",
                status="allowed",
                scope_jeongseong=True,
            )
        )
        await session.commit()
    try:
        yield factory, user_id, period_id, volume
    finally:
        async with factory() as session:
            await session.execute(
                delete(JeongseongReading).where(
                    JeongseongReading.period_id == period_id
                )
            )
            await session.execute(
                delete(JeongseongPeriod).where(JeongseongPeriod.id == period_id)
            )
            await session.execute(
                delete(ClientErrorEvent).where(ClientErrorEvent.user_id == user_id)
            )
            await session.execute(delete(User).where(User.id == user_id))
            await session.execute(
                delete(ContentRight).where(ContentRight.volume == volume)
            )
            await session.commit()
        await engine.dispose()


async def count(session, model, condition):
    return (
        await session.execute(select(func.count()).select_from(model).where(condition))
    ).scalar_one()


async def assert_database_lock_wait(factory, waiter_pid, task):
    """스케줄 지연이 아니라 PostgreSQL 잠금 대기를 관측한다."""
    async with factory() as inspector:
        async with asyncio.timeout(5):
            while True:
                blockers = (
                    await inspector.execute(
                        text("SELECT pg_blocking_pids(:pid)"), {"pid": waiter_pid}
                    )
                ).scalar_one()
                if blockers:
                    return
                assert not task.done(), "행 잠금을 기다리지 않고 저장이 끝났다"
                await asyncio.sleep(0.01)


@pytest.mark.asyncio
async def test_error_authenticated_before_delete_cannot_recreate_user_record(pg):
    factory, user_id, _, _ = pg
    async with factory() as deleter, factory() as reporter:
        # 인증은 삭제 전에 끝났으나 오류 저장은 사용자 잠금 뒤에 대기한다.
        authenticated_user = await UserRepository(reporter).get_by_id(user_id)
        user = await UserRepository(deleter).get_for_update(user_id)
        reporter_pid = (
            await reporter.execute(text("SELECT pg_backend_pid()"))
        ).scalar_one()
        error_task = asyncio.create_task(
            JourneyRepository(reporter).save_error(
                ClientErrorEvent(
                    user_id=authenticated_user.id,
                    kind="api_5xx",
                    message="API 서비스 오류",
                    path="/hoondok/search",
                )
            )
        )
        try:
            await assert_database_lock_wait(factory, reporter_pid, error_task)
            await IdentityService(UserRepository(deleter)).delete_account(
                user, [JeongseongRepository(deleter)]
            )
            await asyncio.wait_for(error_task, timeout=5)
            assert (
                await count(
                    reporter, ClientErrorEvent, ClientErrorEvent.user_id == user_id
                )
                == 0
            )
        finally:
            if not error_task.done():
                error_task.cancel()
            await asyncio.gather(error_task, return_exceptions=True)


@pytest.mark.asyncio
async def test_delete_locks_parent_before_child_delete(pg):
    factory, user_id, period_id, volume = pg
    child_deleted, allow_delete = asyncio.Event(), asyncio.Event()
    async with factory() as deleter, factory() as writer:
        writer_pid = (
            await writer.execute(text("SELECT pg_backend_pid()"))
        ).scalar_one()
        original_execute = deleter.execute

        async def paused_execute(statement, *args, **kwargs):
            result = await original_execute(statement, *args, **kwargs)
            if (
                getattr(statement, "is_delete", False)
                and statement.table.name == "jeongseong_readings"
            ):
                child_deleted.set()
                await allow_delete.wait()
            return result

        deleter.execute = paused_execute
        user = await UserRepository(deleter).get_by_id(user_id)
        deletion = asyncio.create_task(
            IdentityService(UserRepository(deleter)).delete_account(
                user, [JeongseongRepository(deleter)]
            )
        )
        insertion = None
        try:
            await asyncio.wait_for(child_deleted.wait(), timeout=5)
            insertion = asyncio.create_task(
                JourneyRepository(writer).save_reading(
                    JeongseongReading(
                        period_id=period_id,
                        reading_date=DAY,
                        volume=volume,
                        chunk_id="late",
                        body=BODY,
                        title="감사",
                        work_title="검증",
                    )
                )
            )
            done, _ = await asyncio.wait({insertion}, timeout=0.1)
            assert not done, (
                "자식 DELETE와 부모 DELETE 사이에 새 말씀이 저장되면 안 된다"
            )
            allow_delete.set()
            await asyncio.wait_for(deletion, timeout=5)
            assert await asyncio.wait_for(insertion, timeout=5) is None
            assert (
                await count(
                    writer, JeongseongReading, JeongseongReading.period_id == period_id
                )
                == 0
            )
            assert (
                await count(writer, JeongseongPeriod, JeongseongPeriod.id == period_id)
                == 0
            )
        finally:
            allow_delete.set()
            for task in (deletion, insertion):
                if task is not None and not task.done():
                    task.cancel()
            await asyncio.gather(
                *(task for task in (deletion, insertion) if task is not None),
                return_exceptions=True,
            )


@pytest.mark.asyncio
async def test_midnight_requests_recheck_history_under_period_lock(pg):
    factory, user_id, period_id, volume = pg
    barrier = asyncio.Barrier(2)

    async def search(*args, **kwargs):
        await barrier.wait()
        return [
            SearchResult(BODY, volume, 0, 0.9, chunk_id="first"),
            SearchResult(BODY, volume, 1, 0.8, chunk_id="same-body"),
            SearchResult(OTHER_BODY, volume, 2, 0.7, chunk_id="second"),
        ]

    async def request(day):
        async with factory() as session:
            service = JourneyService(
                JourneyRepository(session),
                AsyncMock(),
                JeongseongRepository(session),
                today_fn=lambda: day,
                search_fn=search,
            )
            return await service.today(user_id)

    before, after = await asyncio.wait_for(
        asyncio.gather(request(DAY), request(DAY + timedelta(days=1))), timeout=10
    )
    assert before.date == DAY and after.date == DAY + timedelta(days=1)
    assert before.status == after.status == "available"
    assert before.reading.body != after.reading.body
    async with factory() as session:
        rows = await JourneyRepository(session).list_readings(period_id)
        assert len(rows) == 2
        assert {row.chunk_id for row in rows} == {"first", "second"}
        assert {row.reading_date for row in rows} == {DAY, DAY + timedelta(days=1)}
