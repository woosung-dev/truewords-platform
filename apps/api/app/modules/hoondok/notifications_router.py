"""훈독 알림 API — /hoondok/push/config 는 공개, /hoondok/me/* 는 hoondok_token (API-HD-019~022)."""

from fastapi import APIRouter, Depends, Query, status

from app.modules.hoondok.dependencies import get_notification_service
from app.modules.hoondok.notifications_schemas import (
    NotificationPreferenceInput,
    NotificationPreferenceResponse,
    PushConfigResponse,
    PushSubscriptionInput,
    PushSubscriptionResponse,
)
from app.modules.hoondok.notifications_service import NotificationService
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User

router = APIRouter(prefix="/hoondok", tags=["hoondok"])


@router.get("/push/config", response_model=PushConfigResponse)
async def get_push_config(
    service: NotificationService = Depends(get_notification_service),
) -> PushConfigResponse:
    """API-HD-019 VAPID 공개 키. 미설정이면 enabled=false — 항상 200, 인증 불필요."""
    return service.push_config()


@router.get("/me/notifications", response_model=NotificationPreferenceResponse)
async def get_notifications(
    user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> NotificationPreferenceResponse:
    """API-HD-020 알림 설정. 저장된 행이 없으면 기본값(끔·06:00·neutral). 401 미인증."""
    return await service.get_preference(user.id)


@router.put(
    "/me/notifications",
    response_model=NotificationPreferenceResponse,
    dependencies=[Depends(verify_csrf)],
)
async def put_notifications(
    data: NotificationPreferenceInput,
    user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> NotificationPreferenceResponse:
    """API-HD-020 알림 설정 전체 교체. 422 시각·수위 형식, 403 CSRF, 401 미인증."""
    return await service.put_preference(user.id, data)


@router.post(
    "/me/push",
    response_model=PushSubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def create_push_subscription(
    data: PushSubscriptionInput,
    user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> PushSubscriptionResponse:
    """API-HD-021 구독 등록(endpoint upsert). 409 PUSH_DISABLED, 422 형식, 403 CSRF, 401 미인증."""
    return await service.subscribe(user.id, data)


@router.delete("/me/push", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def delete_push_subscription(
    endpoint: str = Query(min_length=1, max_length=2048),
    user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> None:
    """API-HD-022 구독 해지. 본인 것만 지우고 없어도 204. 403 CSRF, 401 미인증."""
    await service.unsubscribe(user.id, endpoint)
