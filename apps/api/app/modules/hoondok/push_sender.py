"""훈독 Web Push 발송기 (PLAN-HD-006 §2 6~9). 스케줄러는 VM cron 이고 진입점은 scripts/send_hoondok_push.py 다.

정책:
  - 대상: `read_enabled` · 발송 창(`read_time` ~ +2h) 안 · 오늘 아직 안 보냄 · 계정 살아 있음 · 오늘 `read` 미완료
  - 오늘 공식 편성(`GET /hoondok/today` 가 available)이 없으면, 진행 중 정성 기간이 있고 정성 말씀을 뽑을
    권리(allowed · scope_jeongseong)가 1건이라도 있는 사용자에게만 보낸다. 나머지는 생략한다
  - 정성 기간 알림은 따로 보내지 않는다 — 진행 중이면 훈독하기 알림 1건의 문구에 N일차를 합친다
  - 구독 단위 발송(한 사용자 기기 N대 → N건), 하루 1회(`last_sent_on`)
  - 404/410 은 만료 구독이라 즉시 삭제, 그 밖의 실패는 `failed_count` 누적 5회에 삭제
  - VAPID 3값이 없으면 아무것도 하지 않는다(`disabled`)

pywebpush 는 동기 라이브러리다 — 이벤트 루프를 막지 않도록 `asyncio.to_thread` 로 감싼다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timezone

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.common.clock import KST
from app.core.config import Settings, settings as default_settings
from app.modules.hoondok.jeongseong import period_end
from app.modules.hoondok.models import (
    ContentRight,
    JeongseongPeriod,
    MissionLog,
    NotificationPreference,
    PushSubscription,
)
from app.modules.identity.models import User

logger = logging.getLogger(__name__)

WINDOW_MINUTES = 120  # §2-7 발송 창: read_time 이후 2시간
MAX_FAILURES = 5  # §2-8 누적 실패 상한 (도달 시 구독 삭제)
EXPIRED_STATUSES = (404, 410)  # 만료·해지된 구독 — 즉시 삭제
# 401/403 = VAPID 키·subject 문제, 429 = 푸시 서비스 레이트리밋. 모두 우리 쪽·서비스 쪽 원인이라
# 전 구독에 동시에 생긴다 — 구독 탓으로 누적하면 창 한 번(8회 시도)에 전 구독이 지워진다.
TRANSIENT_STATUSES = (401, 403, 429)
DELIVER_TIMEOUT_SECONDS = 10  # pywebpush 기본은 timeout=None(무한 대기) — cron 이 매달리지 않게
TTL_SECONDS = 7200  # 창을 지난 뒤 배달되는 것을 막는다(창 길이와 같다)
URGENCY = "high"  # 정해진 시각 알림이라 안드로이드 Doze 지연 방지(RFC 8030 §5.3 Urgency 헤더)
BODY_TEXT = "3분이면 충분해요"
TARGET_URL = "/hoondok"
TITLES = {
    "neutral": "오늘의 읽을거리가 준비됐어요",
    "faith": "오늘의 말씀이 준비됐어요",
}
MISSION_KIND_READ = "read"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def now_kst(now: datetime | None = None) -> datetime:
    """KST 기준 현재 시각. `now` 는 tz-aware 또는 naive UTC 를 받는다(테스트 주입용)."""
    current = now or _utcnow()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(KST)


def is_in_window(read_time: time, current: time) -> bool:
    """`read_time` 이상 `read_time + 2h` 미만이면 True.

    자정 넘김은 고려하지 않는다(§2-7) — 23:30 설정이면 그날 24:00 까지만 본다.
    경계: 정확히 `read_time` 은 포함, 정확히 +2h 는 제외.
    """
    start = read_time.hour * 60 + read_time.minute
    end = min(start + WINDOW_MINUTES, 24 * 60)
    minute_of_day = current.hour * 60 + current.minute
    return start <= minute_of_day < end


@dataclass(frozen=True)
class JeongseongDay:
    """진행 중 정성 기간의 오늘 일차 — 알림 문구용."""

    topic: str
    day: int  # 1..duration_days


def build_payload(lock_screen_level: str, jeongseong: JeongseongDay | None = None) -> dict[str, str]:
    """잠금화면 문구 수위별 페이로드(§2-9). 모르는 값은 중립형으로 떨어진다.

    정성 기간이 진행 중이면 같은 알림 1건에 N일차를 합친다. 중립형은 제목을 그대로 두고 본문에만
    일차를 붙인다 — 정성 주제(신앙 맥락)를 잠금 화면에 드러내지 않는다.
    """
    level = lock_screen_level if lock_screen_level in TITLES else "neutral"
    if jeongseong is None:
        title, body = TITLES[level], BODY_TEXT
    elif level == "faith":
        title, body = f"{jeongseong.topic} 정성 {jeongseong.day}일차", TITLES["faith"]
    else:
        title, body = TITLES["neutral"], f"{jeongseong.day}일차 · {BODY_TEXT}"
    return {"title": title, "body": body, "url": TARGET_URL}


def _jeongseong_day(period: JeongseongPeriod | None, today: date) -> JeongseongDay | None:
    if period is None:
        return None
    return JeongseongDay(topic=period.topic, day=(today - period.started_on).days + 1)


@dataclass(frozen=True)
class PushTarget:
    """발송 대상 1건 = 구독 1개."""

    subscription: PushSubscription
    lock_screen_level: str
    jeongseong: JeongseongDay | None = None


@dataclass
class PushSummary:
    """stdout 요약 1줄. pruned 는 삭제된 구독 수이고 failed 의 부분집합이다.

    skipped_* 는 구독 단위로 센다. 오늘 이미 완료했으면 편성 여부와 무관하게 skipped_done 이다.
    """

    mode: str
    eligible: int = 0
    sent: int = 0
    failed: int = 0
    pruned: int = 0
    skipped_done: int = 0
    skipped_no_reading: int = 0

    def as_dict(self) -> dict[str, object]:
        return {
            "mode": self.mode,
            "eligible": self.eligible,
            "sent": self.sent,
            "failed": self.failed,
            "pruned": self.pruned,
            "skipped_done": self.skipped_done,
            "skipped_no_reading": self.skipped_no_reading,
        }


class PushSenderRepository:
    """발송기 전용 조회/갱신. AsyncSession 은 여기만 보유한다(라우터 경로와 같은 규약)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_candidates(self, today: date) -> Sequence[tuple[PushSubscription, str]]:
        """알림 켠 · 계정 살아 있는 · 오늘 아직 안 보낸 구독. 창·완료 판정은 파이썬에서 한다."""
        result = await self.session.execute(
            select(PushSubscription, NotificationPreference)
            .join(
                NotificationPreference,
                NotificationPreference.user_id == PushSubscription.user_id,
            )
            .join(User, User.id == PushSubscription.user_id)
            .where(
                NotificationPreference.read_enabled.is_(True),
                User.deleted_at.is_(None),
                or_(
                    PushSubscription.last_sent_on.is_(None),
                    PushSubscription.last_sent_on < today,
                ),
            )
        )
        return [(sub, pref) for sub, pref in result.all()]

    async def list_for_email(self, email: str) -> tuple[Sequence[PushSubscription], str]:
        """`--to-email` 용. 창·완료·편성·last_sent_on 을 보지 않는다(삭제된 계정만 제외)."""
        user = (
            await self.session.execute(
                select(User).where(User.email == email.strip().lower(), User.deleted_at.is_(None))
            )
        ).scalar_one_or_none()
        if user is None:
            return [], "neutral"
        subs = (
            (
                await self.session.execute(
                    select(PushSubscription).where(PushSubscription.user_id == user.id)
                )
            )
            .scalars()
            .all()
        )
        pref = await self.session.get(NotificationPreference, user.id)
        return subs, (pref.lock_screen_level if pref else "neutral")

    async def users_done_today(self, today: date, user_ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
        ids = list(dict.fromkeys(user_ids))
        if not ids:
            return set()
        result = await self.session.execute(
            select(MissionLog.user_id).where(
                MissionLog.mission_date == today,
                MissionLog.kind == MISSION_KIND_READ,
                MissionLog.user_id.in_(ids),
            )
        )
        return set(result.scalars().all())

    async def jeongseong_in_progress(
        self, today: date, user_ids: Iterable[uuid.UUID]
    ) -> dict[uuid.UUID, JeongseongPeriod]:
        """오늘 진행 중인 정성 기간(사용자당 최대 1건 — 부분 unique). 후보 전체를 한 번의 쿼리로 가져온다.

        종료일은 파이썬에서 `period_end` 로 거른다(DB 별 날짜 산술을 피한다). active 인데 종료일이 지난
        기간은 읽는 시점에 completed 로 정리되지만(JeongseongService) 발송기는 쓰지 않고 건너뛰기만 한다.
        """
        ids = list(dict.fromkeys(user_ids))
        if not ids:
            return {}
        result = await self.session.execute(
            select(JeongseongPeriod).where(
                JeongseongPeriod.user_id.in_(ids),
                JeongseongPeriod.status == "active",
                JeongseongPeriod.started_on <= today,
            )
        )
        return {
            period.user_id: period
            for period in result.scalars().all()
            if today <= period_end(period.started_on, period.duration_days)
        }

    async def has_jeongseong_source(self) -> bool:
        """정성 말씀을 뽑을 권리(allowed · scope_jeongseong)가 1건이라도 있는가 — 없으면 정성 말씀이 만들어질 수 없다.

        남는 위험: 권리는 있어도 주제에 맞는 후보가 0건이면 그날 정성 말씀은 비어 있다(후보 검색은 cron 에서 하지 않는다).
        """
        result = await self.session.execute(
            select(ContentRight.id)
            .where(ContentRight.status == "allowed", ContentRight.scope_jeongseong.is_(True))
            .limit(1)
        )
        return result.first() is not None

    async def mark_sent(self, subscription: PushSubscription, today: date) -> None:
        subscription.last_sent_on = today
        subscription.failed_count = 0
        self.session.add(subscription)
        await self.session.commit()

    async def bump_failure(self, subscription: PushSubscription) -> bool:
        """실패 누적. 상한에 닿으면 삭제하고 True 를 돌려준다."""
        subscription.failed_count += 1
        if subscription.failed_count >= MAX_FAILURES:
            await self.remove(subscription)
            return True
        self.session.add(subscription)
        await self.session.commit()
        return False

    async def remove(self, subscription: PushSubscription) -> None:
        await self.session.execute(
            delete(PushSubscription).where(PushSubscription.id == subscription.id)
        )
        await self.session.commit()


def _deliver(subscription: PushSubscription, payload: dict[str, str], config: Settings) -> None:
    """동기 pywebpush 호출. vapid_claims 는 호출마다 새 dict 다 — 라이브러리가 exp·aud 를 채워 넣는다."""
    private_key = config.hoondok_vapid_private_key
    webpush(
        subscription_info={
            "endpoint": subscription.endpoint,
            "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
        },
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=private_key.get_secret_value() if private_key else "",
        vapid_claims={"sub": config.hoondok_vapid_subject or ""},
        ttl=TTL_SECONDS,
        headers={"Urgency": URGENCY},
        timeout=DELIVER_TIMEOUT_SECONDS,
    )


async def _send_targets(
    repo: PushSenderRepository,
    targets: Sequence[PushTarget],
    *,
    today: date,
    config: Settings,
    summary: PushSummary,
    mark_sent: bool,
) -> None:
    """구독 하나의 실패가 나머지를 막지 않는다 — 예외는 여기서 전부 흡수한다."""
    for target in targets:
        subscription = target.subscription
        payload = build_payload(target.lock_screen_level, target.jeongseong)
        try:
            await asyncio.to_thread(_deliver, subscription, payload, config)
        except WebPushException as exc:
            summary.failed += 1
            status = getattr(exc, "status_code", None)
            if status in EXPIRED_STATUSES:
                logger.info("[prune] endpoint 만료 status=%s id=%s", status, subscription.id)
                await repo.remove(subscription)
                summary.pruned += 1
            elif status is not None and 400 <= status < 500 and status not in TRANSIENT_STATUSES:
                # 구독 자체의 문제(키 불일치·잘못된 endpoint 등) — 누적 5회에 삭제한다.
                logger.warning("[fail] push 거절 status=%s id=%s", status, subscription.id)
                if await repo.bump_failure(subscription):
                    summary.pruned += 1
            else:
                # 5xx·401/403/429·상태 없음 = 푸시 서비스·우리 설정 쪽 장애다. 구독 탓이 아니므로 누적하지 않는다 —
                # 15분 cron 이 5번만 연속 실패해도 전 구독이 지워지는 사고를 막는다.
                logger.warning("[fail] push 서비스 오류 status=%s id=%s", status, subscription.id)
        except Exception:
            # 네트워크 단절 등 우리 쪽·경로 장애. 위와 같은 이유로 누적하지 않는다.
            summary.failed += 1
            logger.exception("[fail] push 예외 id=%s", subscription.id)
        else:
            summary.sent += 1
            if mark_sent:
                await repo.mark_sent(subscription, today)


async def run_push_sender(
    *,
    execute: bool = False,
    to_email: str | None = None,
    config: Settings = default_settings,
    session_factory: Callable[[], AsyncSession] | None = None,
    now: datetime | None = None,
) -> PushSummary:
    """발송 1회. VAPID 미설정이면 DB 도 열지 않고 `disabled` 요약만 돌려준다."""
    if not config.is_hoondok_push_enabled():
        return PushSummary(mode="disabled")

    if to_email and execute:
        mode = "to-email"
    elif execute:
        mode = "execute"
    else:
        mode = "dry-run"  # --to-email 만 있고 --execute 가 없으면 후보만 센다 — 실기기로 나가지 않는다
    summary = PushSummary(mode=mode)

    if session_factory is None:
        from app.core.common.database import async_session_factory

        session_factory = async_session_factory

    current = now_kst(now)
    today = current.date()

    async with session_factory() as session:
        repo = PushSenderRepository(session)

        if to_email:
            subs, level = await repo.list_for_email(to_email)
            # 창·완료·편성은 무시하지만 진행 중 정성은 문구에 반영한다 — 실기기에서 N일차 문구를 확인하는 용도.
            in_progress = await repo.jeongseong_in_progress(today, [s.user_id for s in subs])
            targets = [
                PushTarget(
                    subscription=s,
                    lock_screen_level=level,
                    jeongseong=_jeongseong_day(in_progress.get(s.user_id), today),
                )
                for s in subs
            ]
            summary.eligible = len(targets)
            if mode == "dry-run":
                return summary
            # 증거용 즉시 발송이라 last_sent_on 을 건드리지 않는다 — 정규 발송이 그대로 나간다.
            await _send_targets(
                repo, targets, today=today, config=config, summary=summary, mark_sent=False
            )
            return summary

        # 함수 안 import — service 모듈이 검색·임베딩 스택(fastembed·genai)을 끌고 와 15분 cron 기동이 느려진다.
        from app.modules.hoondok.repository import DailyReadingRepository
        from app.modules.hoondok.service import HoondokService

        # 공식 편성은 사용자와 무관하다 — 실행당 1번, `GET /hoondok/today` 와 같은 판정(없음·철회면 말씀 없음).
        # 판정이 실패해도 run 전체를 죽이지 않고 편성 없음으로 본다(정성 사용자는 계속 판정한다).
        # 후보 ORM 객체를 읽기 전에 해 둔다 — rollback 이 이미 읽은 객체를 만료시키지 않게.
        try:
            today_reading = await HoondokService(
                DailyReadingRepository(session), today_fn=lambda: today
            ).get_today()
            has_reading = today_reading.status == "available"
        except Exception:
            logger.exception("[reading] 오늘 편성 판정 실패 — 편성 없음으로 본다")
            await session.rollback()  # 실패한 문장이 트랜잭션을 망가뜨렸을 수 있다(Postgres)
            has_reading = False

        candidates = [
            (sub, pref)
            for sub, pref in await repo.list_candidates(today)
            if is_in_window(pref.read_time, current.time())
        ]
        user_ids = [sub.user_id for sub, _ in candidates]
        done = await repo.users_done_today(today, user_ids)
        in_progress = await repo.jeongseong_in_progress(today, user_ids)
        # 편성 없는 날에만 본다 — 정성 말씀을 뽑을 권리가 0건이면 정성 사용자에게도 "준비됐어요" 가 거짓이다.
        has_jeongseong_source = False if has_reading else await repo.has_jeongseong_source()
        targets: list[PushTarget] = []
        for sub, pref in candidates:
            if sub.user_id in done:
                summary.skipped_done += 1
                continue
            period = in_progress.get(sub.user_id)
            if not has_reading and (period is None or not has_jeongseong_source):
                summary.skipped_no_reading += 1
                continue
            targets.append(
                PushTarget(
                    subscription=sub,
                    lock_screen_level=pref.lock_screen_level,
                    jeongseong=_jeongseong_day(period, today),
                )
            )
        summary.eligible = len(targets)

        if mode == "dry-run":
            return summary

        await _send_targets(
            repo, targets, today=today, config=config, summary=summary, mark_sent=True
        )
        return summary
