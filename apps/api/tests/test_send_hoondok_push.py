"""훈독 Web Push 발송기 (PLAN-HD-006 sub-PR B) — 창·완료·중복·편성 판정, 정성 기간 문구, 구독 정리, 모드별 부작용.

네트워크는 0 이다. pywebpush 는 모듈 전역을 monkeypatch 로 갈아끼운다.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from pydantic import SecretStr
from pywebpush import WebPushException
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.core.common.clock import KST
from app.core.config import settings
from app.modules.hoondok import push_sender
from app.modules.hoondok.models import (
    ContentRight,
    DailyReading,
    JeongseongPeriod,
    MissionLog,
    NotificationPreference,
    PushSubscription,
)
from app.modules.hoondok.push_sender import JeongseongDay, build_payload, is_in_window, run_push_sender
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
    """기본은 오늘(TODAY) 공식 편성이 있는 날이다 — 편성 없는 날은 `_set_reading(factory, None)`."""
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
                DailyReading.__table__,
                JeongseongPeriod.__table__,
                ContentRight.__table__,
            ],
        )
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    await _set_reading(session_factory, "reviewed")
    try:
        yield session_factory
    finally:
        await engine.dispose()


async def _seed(
    factory,
    *,
    email: str = "me@example.com",
    read_enabled: bool = True,
    read_time: time = time(6, 0),
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
            deleted_at=datetime(2026, 9, 1, tzinfo=timezone.utc) if deleted else None,
        )
        session.add(user)
        await session.commit()
        session.add(
            NotificationPreference(
                user_id=user.id,
                read_enabled=read_enabled,
                read_time=read_time,
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


async def _set_reading(factory, review_status: str | None) -> None:
    """오늘 편성을 바꾼다. None 은 편성 없음, "withdrawn" 은 권리 철회(`/hoondok/today` 가 말씀을 내지 않는다)."""
    async with factory() as session:
        await session.execute(delete(DailyReading).where(DailyReading.reading_date == TODAY))
        if review_status is not None:
            session.add(
                DailyReading(
                    reading_date=TODAY,
                    title="오늘의 말씀",
                    body="본문",
                    speaker="화자",
                    work_title="저작물",
                    authority_grade="O1",
                    review_status=review_status,
                )
            )
        await session.commit()


async def _seed_jeongseong(
    factory,
    user_id: uuid.UUID,
    *,
    started_on: date = TODAY,
    duration_days: int = 21,
    status: str = "active",
    topic: str = "감사",
) -> None:
    async with factory() as session:
        session.add(
            JeongseongPeriod(
                user_id=user_id,
                topic=topic,
                duration_days=duration_days,
                started_on=started_on,
                status=status,
            )
        )
        await session.commit()


async def _seed_right(
    factory, *, status: str = "allowed", scope_jeongseong: bool = True, volume: str = "천성경"
) -> None:
    """정성 말씀을 뽑을 권리 원장 1건. 운영 시드는 status=pending · scope_jeongseong=False 로 들어간다."""
    async with factory() as session:
        session.add(
            ContentRight(
                volume=volume, status=status, scope_jeongseong=scope_jeongseong, work_title=volume
            )
        )
        await session.commit()


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


def test_build_payload_is_single_neutral_text():
    """문구는 하나다 — 말씀 본문·책 이름·신앙 맥락을 잠금 화면에 올리지 않는다."""
    assert build_payload() == {
        "title": "오늘의 책갈피가 꽂혀 있어요",
        "body": "한 장 꺼내 읽어 보세요",
        "url": "/hoondok/bookmark",
    }


def test_build_payload_jeongseong_adds_day_to_body_only():
    """정성 진행 중이면 본문에만 N일차를 붙인다 — 제목·정성 주제는 바꾸거나 드러내지 않는다."""
    assert build_payload(JeongseongDay(day=5)) == {
        "title": "오늘의 책갈피가 꽂혀 있어요",
        "body": "5일차 · 한 장 꺼내 읽어 보세요",
        "url": "/hoondok/bookmark",
    }


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
        "skipped_no_reading": 0,
    }
    (sub,) = await _subscriptions(factory)
    assert sub.last_sent_on == TODAY and sub.failed_count == 0


async def test_payload_and_webpush_arguments(factory, push_on, sent_calls):
    await _seed(factory)

    await _run(factory, execute=True)

    (call,) = sent_calls
    assert call["subscription_info"] == {
        "endpoint": "https://push.example.com/a",
        "keys": {"p256dh": "p256", "auth": "auth"},
    }
    assert json.loads(call["data"]) == {
        "title": "오늘의 책갈피가 꽂혀 있어요",
        "body": "한 장 꺼내 읽어 보세요",
        "url": "/hoondok/bookmark",
    }
    assert call["vapid_private_key"] == "test-private"
    assert call["vapid_claims"] == {"sub": "mailto:admin@example.com"}
    assert call["ttl"] == 7200
    assert call["headers"] == {"Urgency": "high"}  # 없으면 FCM 이 보통 우선순위라 Doze 에서 창을 넘길 수 있다
    assert call["timeout"] == 10  # pywebpush 기본 None 은 무한 대기다


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


# --- 편성·정성 기간 -----------------------------------------------------------


@pytest.mark.parametrize("review_status", [None, "withdrawn"], ids=["no-reading", "rights-withdrawn"])
async def test_no_official_reading_without_jeongseong_is_skipped(
    factory, push_on, sent_calls, review_status
):
    """편성이 없거나 철회된 날 — 읽을 말씀이 없는데 "준비됐어요" 를 보내지 않는다."""
    await _set_reading(factory, review_status)
    await _seed(factory)

    summary = await _run(factory, execute=True)

    assert summary.as_dict() == {
        "mode": "execute",
        "eligible": 0,
        "sent": 0,
        "failed": 0,
        "pruned": 0,
        "skipped_done": 0,
        "skipped_no_reading": 1,
    }
    assert sent_calls == []
    (sub,) = await _subscriptions(factory)
    assert sub.last_sent_on is None  # 창 안에서 편성이 들어오면 다음 cron 이 보낸다


async def test_no_official_reading_with_jeongseong_in_progress_is_sent(factory, push_on, sent_calls):
    """편성이 없어도 정성 기간을 진행 중인 사용자는 보낸다(정성 말씀 권리가 있을 때) — 사용자별 판정이다."""
    await _set_reading(factory, None)
    await _seed_right(factory)
    in_progress = await _seed(factory, email="a@example.com", endpoints=("https://push.example.com/a",))
    await _seed(factory, email="b@example.com", endpoints=("https://push.example.com/b",))
    await _seed_jeongseong(factory, in_progress, started_on=TODAY - timedelta(days=2))

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.sent, summary.skipped_no_reading) == (1, 1, 1)
    (call,) = sent_calls
    assert call["subscription_info"]["endpoint"] == "https://push.example.com/a"
    assert json.loads(call["data"]) == {
        "title": "오늘의 책갈피가 꽂혀 있어요",
        "body": "3일차 · 한 장 꺼내 읽어 보세요",
        "url": "/hoondok/bookmark",
    }


@pytest.mark.parametrize("review_status", ["reviewed", "unverified"])
async def test_official_reading_is_sent_as_before(factory, push_on, sent_calls, review_status):
    """`/hoondok/today` 가 available 이면(검수 전 포함) 기존 문구 그대로 보낸다."""
    await _set_reading(factory, review_status)
    await _seed(factory)

    summary = await _run(factory, execute=True)

    assert (summary.sent, summary.skipped_no_reading) == (1, 0)
    (call,) = sent_calls
    assert json.loads(call["data"])["body"] == "한 장 꺼내 읽어 보세요"


@pytest.mark.parametrize(
    "offset,day",
    [(0, 1), (20, 21)],  # 시작일 = 1일차, 종료일(21일 기간의 마지막 날) = 21일차
    ids=["first-day", "last-day"],
)
async def test_jeongseong_in_progress_merges_day_into_payload(
    factory, push_on, sent_calls, offset, day
):
    """정성 기간 알림은 따로 없다 — 훈독하기 알림 1건에 N일차를 합친다."""
    user_id = await _seed(factory)
    await _seed_jeongseong(factory, user_id, started_on=TODAY - timedelta(days=offset))

    summary = await _run(factory, execute=True)

    assert summary.sent == 1
    (call,) = sent_calls
    assert json.loads(call["data"]) == {
        "title": "오늘의 책갈피가 꽂혀 있어요",
        "body": f"{day}일차 · 한 장 꺼내 읽어 보세요",
        "url": "/hoondok/bookmark",
    }


@pytest.mark.parametrize(
    "started_offset,status",
    [
        (-1, "active"),  # upcoming — 내일 시작
        (21, "active"),  # 종료일이 어제 — 아직 completed 로 정리되지 않은 active
        (2, "completed"),
        (2, "abandoned"),
    ],
    ids=["upcoming", "active-past-end", "completed", "abandoned"],
)
async def test_jeongseong_not_in_progress_is_ignored(
    factory, push_on, sent_calls, started_offset, status
):
    """진행 중이 아닌 정성 기간은 편성 대신이 되지 못하고 문구에도 섞이지 않는다."""
    await _set_reading(factory, None)
    await _seed_right(factory)  # 권리가 있어도 생략된다 — 생략 이유가 권리가 아니라 기간 상태임을 보인다
    user_id = await _seed(factory)
    await _seed_jeongseong(
        factory, user_id, started_on=TODAY - timedelta(days=started_offset), status=status
    )

    summary = await _run(factory, execute=True)

    assert (summary.sent, summary.skipped_no_reading) == (0, 1)

    await _set_reading(factory, "reviewed")
    summary = await _run(factory, execute=True)

    assert summary.sent == 1
    (call,) = sent_calls
    assert json.loads(call["data"]) == {
        "title": "오늘의 책갈피가 꽂혀 있어요",
        "body": "한 장 꺼내 읽어 보세요",
        "url": "/hoondok/bookmark",
    }


@pytest.mark.parametrize(
    "right",
    [
        None,
        {"status": "pending", "scope_jeongseong": True},
        {"status": "withdrawn", "scope_jeongseong": True},
        {"status": "allowed", "scope_jeongseong": False},  # 운영 시드 기본(scope_jeongseong=False)
    ],
    ids=["no-rights", "pending", "withdrawn", "allowed-without-scope"],
)
async def test_no_reading_and_no_jeongseong_source_is_skipped(factory, push_on, sent_calls, right):
    """편성 없음 + 정성 진행 중이어도 정성 말씀을 뽑을 권리가 없으면 "준비됐어요" 가 거짓이다 — 생략한다."""
    await _set_reading(factory, None)
    if right is not None:
        await _seed_right(factory, **right)
    user_id = await _seed(factory)
    await _seed_jeongseong(factory, user_id, started_on=TODAY - timedelta(days=2))

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.sent, summary.skipped_no_reading) == (0, 0, 1)
    assert sent_calls == []

    await _seed_right(factory, volume="평화경")  # allowed · scope_jeongseong 1건이 생기면 보낸다
    summary = await _run(factory, execute=True)

    assert (summary.sent, summary.skipped_no_reading) == (1, 0)


async def test_reading_judgment_failure_does_not_abort_run(factory, push_on, sent_calls, monkeypatch):
    """`/hoondok/today` 판정이 터져도 run 은 끝까지 간다 — 편성 없음으로 보고 정성 사용자만 보낸다."""
    from app.modules.hoondok.service import HoondokService

    async def _boom(self):
        raise RuntimeError("편성 조회 실패")

    monkeypatch.setattr(HoondokService, "get_today", _boom)
    await _seed_right(factory)
    in_progress = await _seed(factory, email="a@example.com", endpoints=("https://push.example.com/a",))
    await _seed(factory, email="b@example.com", endpoints=("https://push.example.com/b",))
    await _seed_jeongseong(factory, in_progress)

    summary = await _run(factory, execute=True)

    assert (summary.eligible, summary.sent, summary.skipped_no_reading) == (1, 1, 1)
    assert [c["subscription_info"]["endpoint"] for c in sent_calls] == ["https://push.example.com/a"]


async def test_done_today_counts_as_done_even_without_reading(factory, push_on, sent_calls):
    """완료 판정이 먼저다 — 편성 없는 날의 완료자는 skipped_done 으로만 센다(중복 집계 없음)."""
    await _set_reading(factory, None)
    await _seed(factory, done_today=True)

    summary = await _run(factory, execute=True)

    assert (summary.skipped_done, summary.skipped_no_reading) == (1, 0)


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


async def test_client_rejection_accumulates_then_prunes(factory, push_on, sent_calls):
    await _seed(factory, failed_count=3)
    sent_calls.raises["https://push.example.com/a"] = WebPushException(
        "bad key", response=FakeResponse(400)
    )

    summary = await _run(factory, execute=True)

    assert (summary.failed, summary.pruned) == (1, 0)
    (sub,) = await _subscriptions(factory)
    assert sub.failed_count == 4  # 4회는 유지

    summary = await _run(factory, execute=True)

    assert (summary.failed, summary.pruned) == (1, 1)
    assert await _subscriptions(factory) == []  # 5회에 삭제


@pytest.mark.parametrize(
    "error",
    [
        WebPushException("service down", response=FakeResponse(500)),
        RuntimeError("네트워크 끊김"),
        WebPushException("bad vapid", response=FakeResponse(401)),
        WebPushException("bad vapid", response=FakeResponse(403)),
        WebPushException("rate limited", response=FakeResponse(429)),
    ],
    ids=["5xx", "network", "401-vapid", "403-vapid", "429-ratelimit"],
)
async def test_service_or_network_failure_does_not_accumulate(factory, push_on, sent_calls, error):
    """푸시 서비스 장애·네트워크 단절은 구독 탓이 아니다 — 연속 cron 실패로 전 구독이 지워지면 안 된다."""
    await _seed(factory, failed_count=4)
    sent_calls.raises["https://push.example.com/a"] = error

    summary = await _run(factory, execute=True)

    assert (summary.failed, summary.pruned) == (1, 0)
    (sub,) = await _subscriptions(factory)
    assert sub.failed_count == 4  # 그대로
    assert sub.last_sent_on is None  # 다음 cron 이 다시 시도한다


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
    assert by_endpoint["https://push.example.com/a"].failed_count == 0  # 네트워크 예외는 누적 안 함
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
        "skipped_no_reading": 0,
    }
    assert sent_calls == []
    (sub,) = await _subscriptions(factory)
    assert sub.last_sent_on is None


async def test_to_email_ignores_window_and_does_not_mark_sent(factory, push_on, sent_calls):
    """창 밖 · 오늘 완료 · 토글 OFF · 편성 없음이어도 보낸다 — 실기기 증거용 1회 발송."""
    await _set_reading(factory, None)
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
        "skipped_no_reading": 0,
    }
    (sub,) = await _subscriptions(factory)
    assert sub.last_sent_on == TODAY  # 정규 발송 판정을 건드리지 않는다


async def test_to_email_reflects_jeongseong_in_progress(factory, push_on, sent_calls):
    """증거 발송도 진행 중 정성의 N일차 문구를 싣는다 — 편성·권리가 없어도 보낸다."""
    await _set_reading(factory, None)
    user_id = await _seed(factory, read_time=time(21, 0))
    await _seed_jeongseong(factory, user_id, started_on=TODAY - timedelta(days=6))

    summary = await _run(factory, execute=True, to_email="me@example.com")

    assert (summary.mode, summary.sent) == ("to-email", 1)
    (call,) = sent_calls
    assert json.loads(call["data"]) == {
        "title": "오늘의 책갈피가 꽂혀 있어요",
        "body": "7일차 · 한 장 꺼내 읽어 보세요",
        "url": "/hoondok/bookmark",
    }


async def test_to_email_without_execute_is_dry_run(factory, push_on, sent_calls):
    """--to-email 만 붙이면 후보만 센다 — --dry-run 인 채로 실기기에 나가면 안 된다."""
    await _seed(factory)

    summary = await _run(factory, to_email="me@example.com")

    assert (summary.mode, summary.eligible, summary.sent) == ("dry-run", 1, 0)
    assert sent_calls == []


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
        "skipped_no_reading": 0,
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
