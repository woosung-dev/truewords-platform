"""훈독 Web Push 발송기 (PLAN-HD-006 sub-PR B) — 창·완료·중복 판정, 구독 정리, 모드별 부작용.

네트워크는 0 이다. pywebpush 는 모듈 전역을 monkeypatch 로 갈아끼운다.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time, timedelta

import pytest
from pydantic import SecretStr
from pywebpush import WebPushException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.core.common.clock import KST
from app.core.config import settings
from app.modules.hoondok import push_sender
from app.modules.hoondok.models import MissionLog, NotificationPreference, PushSubscription
from app.modules.hoondok.push_sender import build_payload, is_in_window, run_push_sender
from app.modules.identity.models import User

TODAY = date(2026, 9, 22)
NOW = datetime(2026, 9, 22, 6, 30, tzinfo=KST)  # 기본 창(06:00~08:00) 안


@pytest.fixture
def push_on(monkeypatch):
    """conftest 의 기본 OFF 를 덮어 VAPID 3값을 채운다."""
    monkeypatch.setattr(settings, "hoondok_vapid_public_key", "BTestPublicKey")
    monkeypatch.setattr(settings, "hoondok_vapid_private_key", SecretStr("test-private"))
    monkeypatch.setattr(settings, "hoondok_vapid_subject", "mailto:admin@example.com")


class FakeResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


class Recorder(list):
    """성공 발송 기록. `raises` 에 endpoint→예외 를 넣으면 그 구독만 실패한다."""

    raises: dict[str, Exception]


@pytest.fixture
def sent_calls(monkeypatch):
    calls = Recorder()
    calls.raises = {}

    def _fake_webpush(**kwargs):
        endpoint = kwargs["subscription_info"]["endpoint"]
        if endpoint in calls.raises:
            raise calls.raises[endpoint]
        calls.append(kwargs)
        return None

    monkeypatch.setattr(push_sender, "webpush", _fake_webpush)
    return calls


@pytest.fixture
async def factory():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[
                User.__table__,
                NotificationPreference.__table__,
                PushSubscription.__table__,
                MissionLog.__table__,
            ],
        )
    try:
        yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    finally:
        await engine.dispose()


async def _seed(
    factory,
    *,
    email: str = "me@example.com",
    read_enabled: bool = True,
    read_time: time = time(6, 0),
    level: str = "neutral",
    endpoints: tuple[str, ...] = ("https://push.example.com/a",),
    last_sent_on: date | None = None,
    failed_count: int = 0,
    deleted: bool = False,
    done_today: bool = False,
) -> uuid.UUID:
    async with factory() as session:
        user = User(
            email=email,
            password_hash="x",
            display_name="효진",
            deleted_at=datetime(2026, 9, 1) if deleted else None,
        )
        session.add(user)
        await session.commit()
        session.add(
            NotificationPreference(
                user_id=user.id,
                read_enabled=read_enabled,
                read_time=read_time,
                lock_screen_level=level,
            )
        )
        for endpoint in endpoints:
            session.add(
                PushSubscription(
                    user_id=user.id,
                    endpoint=endpoint,
                    p256dh="p256",
                    auth="auth",
                    last_sent_on=last_sent_on,
                    failed_count=failed_count,
                )
            )
        if done_today:
            session.add(MissionLog(user_id=user.id, mission_date=TODAY, kind="read"))
        await session.commit()
        return user.id


async def _subscriptions(factory) -> list[PushSubscription]:
    async with factory() as session:
        result = await session.execute(select(PushSubscription))
        return list(result.scalars().all())


async def _run(factory, **kwargs):
    return await run_push_sender(config=settings, session_factory=factory, now=NOW, **kwargs)


# --- 순수 함수 ---------------------------------------------------------------


@pytest.mark.parametrize(
    "current,expected",
    [
        (time(5, 59), False),
        (time(6, 0), True),  # 경계 포함
        (time(7, 59), True),
        (time(8, 0), False),  # 경계 제외
        (time(9, 0), False),
    ],
)
def test_is_in_window_boundaries(current: time, expected: bool):
    assert is_in_window(time(6, 0), current) is expected


def test_is_in_window_does_not_wrap_past_midnight():
    """23:30 설정은 24:00 까지만 본다 — 다음 날 01:00 으로 넘기지 않는다(§2-7)."""
    assert is_in_window(time(23, 30), time(23, 59)) is True
    assert is_in_window(time(23, 30), time(0, 30)) is False


@pytest.mark.parametrize(
    "level,title",
    [
        ("neutral", "오늘의 읽을거리가 준비됐어요"),
        ("faith", "오늘의 말씀이 준비됐어요"),
        ("unknown", "오늘의 읽을거리가 준비됐어요"),  # 모르는 값은 중립형
    ],
)
def test_build_payload_titles(level: str, title: str):
    payload = build_payload(level)
    assert payload == {"title": title, "body": "3분이면 충분해요", "url": "/hoondok"}


# --- 대상 선정 ----------------------------------------------------------------


async def test_execute_sends_and_marks_sent(factory, push_on, sent_calls):
    await _seed(factory)

    summary = await _run(factory, execute=True)

    assert summary.as_dict() == {
        "mode": "execute",
        "eligible": 1,
        "sent": 1,
        "failed": 0,
        "pruned": 0,
        "skipped_done": 0,
    }
    (sub,) = await _subscriptions(factory)
    assert sub.last_sent_on == TODAY and sub.failed_count == 0


async def test_payload_and_webpush_arguments(factory, push_on, sent_calls):
    await _seed(factory, level="faith")

    await _run(factory, execute=True)

    (call,) = sent_calls
    assert call["subscription_info"] == {
        "endpoint": "https://push.example.com/a",
        "keys": {"p256dh": "p256", "auth": "auth"},
    }
    assert json.loads(call["data"]) == {
        "title": "오늘의 말씀이 준비됐어요",
        "body": "3분이면 충분해요",
        "url": "/hoondok",
    }
    assert call["vapid_private_key"] == "test-private"
    assert call["vapid_claims"] == {"sub": "mailto:admin@example.com"}
    assert call["ttl"] == 7200


async def test_outside_window_is_not_sent(factory, push_on, sent_calls):
    await _seed(factory, read_time=time(21, 0))  # NOW=06:30 은 창 밖

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.sent) == (0, 0)
    assert sent_calls == []


async def test_read_disabled_is_not_sent(factory, push_on, sent_calls):
    await _seed(factory, read_enabled=False)

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.sent) == (0, 0)


async def test_today_completed_user_is_skipped(factory, push_on, sent_calls):
    await _seed(factory, done_today=True)

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.sent, summary.skipped_done) == (0, 0, 1)
    assert sent_calls == []


async def test_already_sent_today_is_excluded(factory, push_on, sent_calls):
    await _seed(factory, last_sent_on=TODAY)

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.skipped_done) == (0, 0)


async def test_sent_yesterday_is_included(factory, push_on, sent_calls):
    await _seed(factory, last_sent_on=TODAY - timedelta(days=1))

    summary = await _run(factory, execute=True)

    assert summary.sent == 1


async def test_deleted_user_is_excluded(factory, push_on, sent_calls):
    await _seed(factory, deleted=True)

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.sent) == (0, 0)


async def test_one_user_many_devices_gets_one_push_each(factory, push_on, sent_calls):
    await _seed(
        factory, endpoints=("https://push.example.com/a", "https://push.example.com/b")
    )

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.sent) == (2, 2)
    assert len(sent_calls) == 2


# --- 실패 처리 ----------------------------------------------------------------


@pytest.mark.parametrize("status", [404, 410])
async def test_expired_subscription_is_pruned(factory, push_on, sent_calls, status: int):
    await _seed(factory)
    sent_calls.raises["https://push.example.com/a"] = WebPushException(
        "gone", response=FakeResponse(status)
    )

    summary = await _run(factory, execute=True)

    assert (summary.sent, summary.failed, summary.pruned) == (0, 1, 1)
    assert await _subscriptions(factory) == []


async def test_generic_failure_accumulates_then_prunes(factory, push_on, sent_calls):
    await _seed(factory, failed_count=3)
    sent_calls.raises["https://push.example.com/a"] = WebPushException(
        "boom", response=FakeResponse(500)
    )

    summary = await _run(factory, execute=True)

    assert (summary.failed, summary.pruned) == (1, 0)
    (sub,) = await _subscriptions(factory)
    assert sub.failed_count == 4  # 4회는 유지

    summary = await _run(factory, execute=True)

    assert (summary.failed, summary.pruned) == (1, 1)
    assert await _subscriptions(factory) == []  # 5회에 삭제


async def test_non_webpush_exception_also_counts(factory, push_on, sent_calls):
    await _seed(factory, failed_count=4)
    sent_calls.raises["https://push.example.com/a"] = RuntimeError("네트워크 끊김")

    summary = await _run(factory, execute=True)

    assert (summary.failed, summary.pruned) == (1, 1)
    assert await _subscriptions(factory) == []


async def test_failure_does_not_block_next_subscription(factory, push_on, sent_calls):
    await _seed(
        factory, endpoints=("https://push.example.com/a", "https://push.example.com/b")
    )
    sent_calls.raises["https://push.example.com/a"] = RuntimeError("첫 기기 실패")

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.sent, summary.failed) == (2, 1, 1)
    assert [c["subscription_info"]["endpoint"] for c in sent_calls] == [
        "https://push.example.com/b"
    ]
    by_endpoint = {s.endpoint: s for s in await _subscriptions(factory)}
    assert by_endpoint["https://push.example.com/a"].failed_count == 1
    assert by_endpoint["https://push.example.com/a"].last_sent_on is None
    assert by_endpoint["https://push.example.com/b"].last_sent_on == TODAY


# --- 모드 --------------------------------------------------------------------


async def test_dry_run_selects_without_side_effects(factory, push_on, sent_calls):
    await _seed(factory)

    summary = await _run(factory)

    assert summary.as_dict() == {
        "mode": "dry-run",
        "eligible": 1,
        "sent": 0,
        "failed": 0,
        "pruned": 0,
        "skipped_done": 0,
    }
    assert sent_calls == []
    (sub,) = await _subscriptions(factory)
    assert sub.last_sent_on is None


async def test_to_email_ignores_window_and_does_not_mark_sent(factory, push_on, sent_calls):
    """창 밖 · 오늘 완료 · 토글 OFF 여도 보낸다 — 실기기 증거용 1회 발송."""
    await _seed(
        factory,
        read_enabled=False,
        read_time=time(21, 0),
        done_today=True,
        last_sent_on=TODAY,
    )

    summary = await _run(factory, execute=True, to_email="ME@example.com")

    assert summary.as_dict() == {
        "mode": "to-email",
        "eligible": 1,
        "sent": 1,
        "failed": 0,
        "pruned": 0,
        "skipped_done": 0,
    }
    (sub,) = await _subscriptions(factory)
    assert sub.last_sent_on == TODAY  # 정규 발송 판정을 건드리지 않는다


async def test_to_email_unknown_account_sends_nothing(factory, push_on, sent_calls):
    await _seed(factory)

    summary = await _run(factory, execute=True, to_email="nobody@example.com")

    assert (summary.eligible, summary.sent) == (0, 0)
    assert sent_calls == []


async def test_disabled_without_vapid(factory, sent_calls):
    """conftest 가 VAPID 를 비워 둔 기본 상태 — DB 도 열지 않는다."""
    await _seed(factory)

    summary = await _run(factory, execute=True)

    assert summary.as_dict() == {
        "mode": "disabled",
        "eligible": 0,
        "sent": 0,
        "failed": 0,
        "pruned": 0,
        "skipped_done": 0,
    }
    assert sent_calls == []


def test_script_exits_zero_when_disabled(capsys):
    """cron 이 VAPID 등록 전에 돌아도 실패하지 않는다."""
    import importlib.util
    from pathlib import Path

    script = Path(__file__).resolve().parent.parent / "scripts" / "send_hoondok_push.py"
    spec = importlib.util.spec_from_file_location("send_hoondok_push", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.main(["--dry-run"]) == 0
    assert json.loads(capsys.readouterr().out.strip())["mode"] == "disabled"
