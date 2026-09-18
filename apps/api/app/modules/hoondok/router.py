"""훈독 API 라우터 — /hoondok/*. today 는 공개, missions·me 는 hoondok_token(admin_token 은 읽지 않는다)."""

from fastapi import APIRouter, Depends, status

from app.modules.hoondok.dependencies import get_hoondok_service, get_mission_service
from app.modules.hoondok.schemas import (
    MissionCompleteResponse,
    MissionKind,
    SummaryResponse,
    TodayReadingResponse,
)
from app.modules.hoondok.service import HoondokService, MissionService
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User

router = APIRouter(prefix="/hoondok", tags=["hoondok"])


@router.get("/today", response_model=TodayReadingResponse)
async def get_today(
    service: HoondokService = Depends(get_hoondok_service),
) -> TodayReadingResponse:
    """API-HD-001 오늘(KST) 말씀. 없으면 status=none, 철회면 withdrawn — 항상 200."""
    return await service.get_today()


@router.post(
    "/missions/{kind}/complete",
    response_model=MissionCompleteResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def complete_mission(
    kind: MissionKind,
    user: User = Depends(get_current_user),
    service: MissionService = Depends(get_mission_service),
) -> MissionCompleteResponse:
    """API-HD-005 오늘(KST) 미션 완료 기록. 409 같은 날 재요청, 422 알 수 없는 kind, 401 미인증."""
    return await service.complete(user.id, kind)


@router.get("/me/summary", response_model=SummaryResponse)
async def get_summary(
    user: User = Depends(get_current_user),
    service: MissionService = Depends(get_mission_service),
) -> SummaryResponse:
    """API-HD-004 오늘 3종 · 연속일 · 최대 · 누적 · 이번 주(read 기준). 401 미인증."""
    return await service.summary(user.id)
