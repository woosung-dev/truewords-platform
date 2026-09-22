"""훈독 알림 Repository — AsyncSession 은 여기만 보유한다 (ENT-HD-008·009)."""

import uuid

from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import NotificationPreference, PushSubscription


class NotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- 알림 설정 (ENT-HD-008) ---------------------------------------------

    async def get_preference(self, user_id: uuid.UUID) -> NotificationPreference | None:
        return await self.session.get(NotificationPreference, user_id)

    async def save_preference(self, preference: NotificationPreference) -> NotificationPreference:
        self.session.add(preference)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(preference)
        return preference

    # --- 푸시 구독 (ENT-HD-009) ---------------------------------------------

    async def get_by_endpoint(self, endpoint: str) -> PushSubscription | None:
        result = await self.session.execute(
            select(PushSubscription).where(PushSubscription.endpoint == endpoint)
        )
        return result.scalar_one_or_none()

    async def count_subscriptions(self, user_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(PushSubscription).where(PushSubscription.user_id == user_id)
        )
        return int(result.scalar_one())

    async def save_subscription(self, subscription: PushSubscription) -> PushSubscription:
        """unique(endpoint) 위반은 IntegrityError 그대로 — service 가 재조회 후 갱신으로 처리한다."""
        self.session.add(subscription)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(subscription)
        return subscription

    async def delete_subscription(self, user_id: uuid.UUID, endpoint: str) -> None:
        """본인 구독만 지운다 — 남의 endpoint 를 넘겨도 조건이 맞지 않아 아무 행도 지워지지 않는다."""
        await self.session.execute(
            delete(PushSubscription).where(
                PushSubscription.user_id == user_id, PushSubscription.endpoint == endpoint
            )
        )
        await self.session.commit()

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """계정 삭제(API-HD-011)의 일부 — 커밋하지 않는다. MissionLogRepository.delete_for_user 와 같은 규약."""
        await self.session.execute(delete(PushSubscription).where(PushSubscription.user_id == user_id))
        await self.session.execute(
            delete(NotificationPreference).where(NotificationPreference.user_id == user_id)
        )
