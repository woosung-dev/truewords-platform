"""인증된 테스트 계정만 자기 기기에 예약한다."""

import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User
from app.modules.hoondok.dependencies import get_notification_repository
from app.modules.hoondok.notifications_repository import NotificationRepository
from app.modules.hoondok.push_test_repository import PushTestRepository
from app.modules.hoondok.push_test_service import allowed

router = APIRouter(prefix="/hoondok/me/push-tests", tags=["hoondok"])


class PushTestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: str = Field(min_length=1, max_length=2048)
    delay_minutes: int = Field(ge=0, le=60)
    request_id: uuid.UUID


class PushTestResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    subscription_id: uuid.UUID
    scheduled_at: datetime
    attempted_at: datetime | None
    status: str
    error_code: str | None


class PushTestState(BaseModel):
    enabled: bool
    jobs: list[PushTestResult]


def require_tester(user: User = Depends(get_current_user)):
    if not allowed(user):
        raise HTTPException(403, "테스트 알림을 사용할 수 없습니다")
    return user


@router.get("", response_model=PushTestState)
async def state(
    user: User = Depends(get_current_user),
    repo: NotificationRepository = Depends(get_notification_repository),
):
    enabled = allowed(user)
    jobs = await PushTestRepository(repo.session).recent(user.id) if enabled else []
    return PushTestState(
        enabled=enabled, jobs=[PushTestResult.model_validate(job) for job in jobs]
    )


@router.post(
    "",
    response_model=PushTestResult,
    status_code=201,
    dependencies=[Depends(verify_csrf)],
)
async def create(
    data: PushTestInput,
    user: User = Depends(require_tester),
    repo: NotificationRepository = Depends(get_notification_repository),
):
    prefs = await repo.get_preference(user.id)
    if not prefs or not prefs.read_enabled:
        raise HTTPException(409, "알림을 먼저 켜 주세요")
    return await PushTestRepository(repo.session).create(
        user.id, data.endpoint, data.delay_minutes, data.request_id
    )


@router.delete("/{job_id}", status_code=204, dependencies=[Depends(verify_csrf)])
async def cancel(
    job_id: uuid.UUID,
    user: User = Depends(require_tester),
    repo: NotificationRepository = Depends(get_notification_repository),
):
    await PushTestRepository(repo.session).cancel(user.id, job_id)
