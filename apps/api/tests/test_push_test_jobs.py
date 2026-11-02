"""예약 시간·중복·취소·발송 경계를 실제 DB 로 검증한다."""

import uuid
from datetime import timedelta
from unittest.mock import patch
import pytest
from fastapi import HTTPException
from pydantic import SecretStr, ValidationError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel import SQLModel
from app.core.common.clock import utcnow
from app.core.config import settings
from app.modules.identity.models import User
from app.modules.hoondok.models import (
    PushTestJob,
    PushSubscription,
    NotificationPreference,
)
from app.modules.hoondok.push_test_repository import PushTestRepository
from app.modules.hoondok.push_test_router import PushTestInput
from app.modules.hoondok.push_test_service import run


@pytest.fixture
async def setup():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[
                User.__table__,
                PushSubscription.__table__,
                NotificationPreference.__table__,
                PushTestJob.__table__,
            ],
        )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        user = User(
            email="tester@example.com", password_hash="test", display_name="테스터"
        )
        session.add(user)
        await session.commit()
        sub = PushSubscription(
            user_id=user.id,
            endpoint="https://push.example/device",
            p256dh="key",
            auth="auth",
        )
        session.add(sub)
        session.add(NotificationPreference(user_id=user.id, read_enabled=True))
        await session.commit()
        config = settings.model_copy(
            update={
                "hoondok_push_test_enabled": True,
                "hoondok_push_test_emails": [user.email],
                "hoondok_vapid_public_key": "public",
                "hoondok_vapid_private_key": SecretStr("private"),
                "hoondok_vapid_subject": "mailto:test@example.com",
            }
        )
        yield session, factory, user, sub, config
    await engine.dispose()


@pytest.mark.parametrize("delay", [0, 5, 10, 60])
async def test_due_time_and_restart(setup, delay):
    session, factory, user, sub, config = setup
    repo = PushTestRepository(session)
    request_id = uuid.uuid4()
    job = await repo.create(user.id, sub.endpoint, delay, request_id)
    assert (await repo.create(user.id, sub.endpoint, delay, request_id)).id == job.id
    async with factory() as restarted:
        with patch("app.modules.hoondok.push_test_service._deliver") as deliver:
            assert (
                await run(
                    PushTestRepository(restarted),
                    config,
                    lambda: job.scheduled_at - timedelta(seconds=1),
                )
                == 0
            )
            assert (
                await run(
                    PushTestRepository(restarted), config, lambda: job.scheduled_at
                )
                == 1
            )
            assert (
                await run(
                    PushTestRepository(restarted), config, lambda: job.scheduled_at
                )
                == 0
            )
            assert deliver.call_count == 1
            assert deliver.call_args.kwargs["ttl"] == 300
    await session.refresh(sub)
    assert sub.last_sent_on is None


async def test_pending_and_cancel(setup):
    session, _, user, sub, _ = setup
    repo = PushTestRepository(session)
    job = await repo.create(user.id, sub.endpoint, 5, uuid.uuid4())
    user_id, job_id, endpoint = user.id, job.id, sub.endpoint
    with pytest.raises(HTTPException):
        await repo.create(user_id, endpoint, 5, uuid.uuid4())
    await repo.cancel(user_id, job_id)
    assert await repo.claim(utcnow() + timedelta(hours=1)) is None


@pytest.mark.parametrize(
    "reason",
    ["disabled", "off", "deleted", "unsubscribed", "transferred", "expired", "failure"],
)
async def test_guards(setup, reason):
    session, _, user, sub, config = setup
    repo = PushTestRepository(session)
    job = await repo.create(user.id, sub.endpoint, 0, uuid.uuid4())
    if reason == "disabled":
        config.hoondok_push_test_enabled = False
    if reason == "off":
        (await session.get(NotificationPreference, user.id)).read_enabled = False
    if reason == "deleted":
        user.deleted_at = utcnow()
    if reason == "unsubscribed":
        await session.delete(sub)
    if reason == "transferred":
        sub.user_id = uuid.uuid4()
    await session.commit()
    with patch(
        "app.modules.hoondok.push_test_service._deliver",
        side_effect=RuntimeError("secret"),
    ) as deliver:
        await run(
            repo,
            config,
            lambda: (
                job.scheduled_at + timedelta(minutes=11 if reason == "expired" else 0)
            ),
        )
    await session.refresh(job)
    assert job.status == (
        "expired"
        if reason == "expired"
        else "failed"
        if reason == "failure"
        else "cancelled"
    )
    assert deliver.call_count == (1 if reason == "failure" else 0)


async def test_interrupted_claim(setup):
    session, _, user, sub, config = setup
    repo = PushTestRepository(session)
    job = await repo.create(user.id, sub.endpoint, 0, uuid.uuid4())
    await repo.claim(job.scheduled_at)
    with patch("app.modules.hoondok.push_test_service._deliver") as deliver:
        await run(repo, config, lambda: job.scheduled_at + timedelta(minutes=6))
        deliver.assert_not_called()
    await session.refresh(job)
    assert job.status == "unknown"


@pytest.mark.parametrize("delay", [-1, 61, 1.5])
def test_invalid_delay(delay):
    with pytest.raises(ValidationError):
        PushTestInput(
            endpoint="https://push.example",
            delay_minutes=delay,
            request_id=uuid.uuid4(),
        )


async def test_hourly_limit_and_other_owner(setup):
    session, _, user, sub, _ = setup
    repo = PushTestRepository(session)
    with pytest.raises(HTTPException):
        await repo.create(uuid.uuid4(), sub.endpoint, 0, uuid.uuid4())
    for _ in range(6):
        job = await repo.create(user.id, sub.endpoint, 0, uuid.uuid4())
        await repo.cancel(user.id, job.id)
    with pytest.raises(HTTPException) as failure:
        await repo.create(user.id, sub.endpoint, 0, uuid.uuid4())
    assert failure.value.status_code == 429
