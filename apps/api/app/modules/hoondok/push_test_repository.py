"""예약의 소유권·동시성·보관 기간을 DB 에서 검사한다."""

import uuid
from datetime import timedelta

from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from fastapi import HTTPException

from app.core.common.clock import utcnow
from app.modules.hoondok.models import (
    PushTestJob,
    PushSubscription,
    NotificationPreference,
)


class PushTestRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def recent(self, user_id):
        return (
            (
                await self.session.execute(
                    select(PushTestJob)
                    .where(PushTestJob.user_id == user_id)
                    .order_by(PushTestJob.created_at.desc())
                    .limit(20)
                )
            )
            .scalars()
            .all()
        )

    async def create(self, user_id, endpoint, delay, request_id):
        # 사용자 행 잠금으로 서로 다른 기기에서의 계정별 한도 검사도 직렬화한다.
        from app.modules.identity.models import User

        await self.session.execute(
            select(User).where(User.id == user_id).with_for_update()
        )
        existing = (
            await self.session.execute(
                select(PushTestJob).where(PushTestJob.request_id == request_id)
            )
        ).scalar_one_or_none()
        if existing:
            if existing.user_id != user_id:
                raise HTTPException(409, "요청 식별자가 이미 사용되었습니다")
            return existing
        sub = (
            await self.session.execute(
                select(PushSubscription).where(
                    PushSubscription.endpoint == endpoint,
                    PushSubscription.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if not sub:
            raise HTTPException(409, "이 기기의 알림을 먼저 켜 주세요")
        now = utcnow()
        recent = (
            (
                await self.session.execute(
                    select(PushTestJob).where(
                        PushTestJob.user_id == user_id,
                        PushTestJob.created_at >= now - timedelta(hours=1),
                    )
                )
            )
            .scalars()
            .all()
        )
        if len(recent) >= 6:
            raise HTTPException(429, "한 시간에 여섯 번까지 테스트할 수 있어요")
        job = PushTestJob(
            user_id=user_id,
            subscription_id=sub.id,
            request_id=request_id,
            scheduled_at=now + timedelta(minutes=delay),
        )
        self.session.add(job)
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise HTTPException(409, "이 기기에 대기 중인 예약이 있어요") from None
        return job

    async def cancel(self, user_id, job_id):
        result = await self.session.execute(
            update(PushTestJob)
            .where(
                PushTestJob.id == job_id,
                PushTestJob.user_id == user_id,
                PushTestJob.status == "queued",
            )
            .values(status="cancelled")
        )
        await self.session.commit()
        if not result.rowcount:
            raise HTTPException(409, "취소할 수 있는 예약이 없습니다")

    async def claim(self, now):
        await self.session.execute(
            delete(PushTestJob).where(PushTestJob.created_at < now - timedelta(days=7))
        )
        await self.session.execute(
            update(PushTestJob)
            .where(
                PushTestJob.status == "processing",
                PushTestJob.attempted_at < now - timedelta(minutes=5),
            )
            .values(status="unknown", error_code="WORKER_INTERRUPTED")
        )
        job = (
            await self.session.execute(
                select(PushTestJob)
                .where(PushTestJob.status == "queued", PushTestJob.scheduled_at <= now)
                .order_by(PushTestJob.scheduled_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
        ).scalar_one_or_none()
        if job:
            job.status = "processing"
            job.attempted_at = now
        await self.session.commit()
        return job

    async def finish(self, job, status, error=None):
        job.status = status
        job.error_code = error
        self.session.add(job)
        await self.session.commit()

    async def context(self, job):
        from app.modules.identity.models import User

        return (
            await self.session.get(User, job.user_id),
            await self.session.get(PushSubscription, job.subscription_id),
            await self.session.get(NotificationPreference, job.user_id),
        )
