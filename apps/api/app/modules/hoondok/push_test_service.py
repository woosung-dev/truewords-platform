"""테스트 발송은 정규 발송 이력과 분리한다."""

import asyncio
import logging
from datetime import timedelta

from app.core.common.clock import utcnow
from app.core.config import settings
from app.modules.hoondok.push_sender import _deliver
from app.modules.hoondok.push_test_repository import PushTestRepository


logger = logging.getLogger(__name__)


def allowed(user, config=settings):
    return bool(
        config.hoondok_push_test_enabled
        and config.is_hoondok_push_enabled()
        and user.deleted_at is None
        and user.email.lower()
        in {email.strip().lower() for email in config.hoondok_push_test_emails}
    )


async def run(repo: PushTestRepository, config=settings, now_fn=utcnow):
    count = 0
    while job := await repo.claim(now_fn()):
        now = now_fn()
        user, sub, prefs = await repo.context(job)
        if now - job.scheduled_at >= timedelta(minutes=10):
            await repo.finish(job, "expired")
        elif (
            not user
            or not allowed(user, config)
            or not sub
            or sub.user_id != job.user_id
            or not prefs
            or not prefs.read_enabled
        ):
            await repo.finish(job, "cancelled")
        else:
            payload = {
                "title": "테스트 알림이에요",
                "body": "예약한 알림이 도착했어요",
                "url": "/hoondok/bookmark",
                "kind": "test",
                "test_id": str(job.id),
            }
            try:
                await asyncio.to_thread(_deliver, sub, payload, config, ttl=300)
            except Exception:
                # 예외 원문은 구독 endpoint 를 포함할 수 있어 저장하지 않는다.
                await repo.finish(job, "failed", "PUSH_REJECTED")
            else:
                await repo.finish(job, "accepted")
        logger.info(
            "push_test id=%s scheduled=%s attempted=%s status=%s code=%s",
            job.id,
            job.scheduled_at.isoformat(),
            job.attempted_at.isoformat(),
            job.status,
            job.error_code,
        )
        count += 1
    return count
