"""훈독 알림 Service — 설정 upsert · 구독 등록/해지 (API-HD-019~022). AsyncSession 을 import 하지 않는다."""

import uuid
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError

from app.core.config import Settings, settings as default_settings
from app.modules.hoondok.exceptions import PushDisabledError
from app.modules.hoondok.models import NotificationPreference, PushSubscription
from app.modules.hoondok.notifications_repository import NotificationRepository
from app.modules.hoondok.notifications_schemas import (
    DEFAULT_READ_TIME,
    NotificationPreferenceInput,
    NotificationPreferenceResponse,
    PushConfigResponse,
    PushSubscriptionInput,
    PushSubscriptionResponse,
    format_read_time,
    parse_read_time,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class NotificationService:
    def __init__(self, repo: NotificationRepository, config: Settings = default_settings) -> None:
        self.repo = repo
        self.config = config

    def push_config(self) -> PushConfigResponse:
        """API-HD-019. 공개 키만 내보낸다 — 미설정이면 enabled=false."""
        if not self.config.is_hoondok_push_enabled():
            return PushConfigResponse(enabled=False, public_key=None)
        return PushConfigResponse(enabled=True, public_key=self.config.hoondok_vapid_public_key)

    async def get_preference(self, user_id: uuid.UUID) -> NotificationPreferenceResponse:
        """API-HD-020 GET. 행이 없으면 저장하지 않고 기본값을 돌려준다."""
        stored = await self.repo.get_preference(user_id)
        count = await self.repo.count_subscriptions(user_id)
        if stored is None:
            return NotificationPreferenceResponse(
                read_enabled=False,
                read_time=DEFAULT_READ_TIME,
                lock_screen_level="neutral",
                subscription_count=count,
            )
        return self._to_response(stored, count)

    async def put_preference(
        self, user_id: uuid.UUID, data: NotificationPreferenceInput
    ) -> NotificationPreferenceResponse:
        """API-HD-020 PUT. 전체 교체 upsert — 부분 수정이 아니다."""
        stored = await self.repo.get_preference(user_id) or NotificationPreference(user_id=user_id)
        stored.read_enabled = data.read_enabled
        stored.read_time = parse_read_time(data.read_time)
        stored.lock_screen_level = data.lock_screen_level
        stored.updated_at = _utcnow()
        saved = await self.repo.save_preference(stored)
        return self._to_response(saved, await self.repo.count_subscriptions(user_id))

    async def subscribe(self, user_id: uuid.UUID, data: PushSubscriptionInput) -> PushSubscriptionResponse:
        """API-HD-021. endpoint 기준 upsert — 같은 기기를 다른 계정이 다시 구독하면 소유가 옮겨간다."""
        if not self.config.is_hoondok_push_enabled():
            raise PushDisabledError()
        existing = await self.repo.get_by_endpoint(data.endpoint)
        if existing is None:
            new = PushSubscription(
                user_id=user_id,
                endpoint=data.endpoint,
                p256dh=data.keys.p256dh,
                auth=data.keys.auth,
                user_agent=data.user_agent,
            )
            try:
                saved = await self.repo.save_subscription(new)
            except IntegrityError:
                # 같은 기기가 동시에 두 번 등록한 경우 — 먼저 들어간 행을 갱신한다.
                existing = await self.repo.get_by_endpoint(data.endpoint)
                if existing is None:
                    raise
            else:
                return PushSubscriptionResponse.model_validate(saved)
        existing.user_id = user_id
        existing.p256dh = data.keys.p256dh
        existing.auth = data.keys.auth
        existing.user_agent = data.user_agent
        existing.failed_count = 0  # 소유·키가 새로 확인됐으니 과거 실패 누적은 지운다
        saved = await self.repo.save_subscription(existing)
        return PushSubscriptionResponse.model_validate(saved)

    async def unsubscribe(self, user_id: uuid.UUID, endpoint: str) -> None:
        """API-HD-022. 본인 구독만 지우고, 없어도 204 다(멱등)."""
        await self.repo.delete_subscription(user_id, endpoint)

    @staticmethod
    def _to_response(row: NotificationPreference, count: int) -> NotificationPreferenceResponse:
        return NotificationPreferenceResponse(
            read_enabled=row.read_enabled,
            read_time=format_read_time(row.read_time),
            lock_screen_level=row.lock_screen_level,  # type: ignore[arg-type]
            subscription_count=count,
        )
