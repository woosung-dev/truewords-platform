"""훈독 API 라우터 — /hoondok/*. today 는 공개, missions·me 는 hoondok_token(admin_token 은 읽지 않는다)."""

from fastapi import APIRouter, Depends, Query, status

from app.modules.hoondok.dependencies import get_hoondok_service, get_jeongseong_service, get_mission_service
from app.modules.hoondok.schemas import (
    JeongseongCreate,
    JeongseongCurrentResponse,
    JeongseongPeriodResponse,
    MissionCompleteResponse,
    MissionKind,
    MonthHistoryResponse,
    SummaryResponse,
    TodayReadingResponse,
)
from app.modules.hoondok.service import HoondokService, JeongseongService, MissionService
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User

router = APIRouter(prefix="/hoondok", tags=["hoondok"])

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


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


@router.get("/me/history", response_model=MonthHistoryResponse)
async def get_history(
    month: str | None = Query(default=None, pattern=MONTH_PATTERN, description="YYYY-MM. 생략 시 오늘(KST)의 월"),
    user: User = Depends(get_current_user),
    service: MissionService = Depends(get_mission_service),
) -> MonthHistoryResponse:
    """API-HD-010 한 달의 날마다 read 완료 여부. 422 형식·연도 범위 위반, 401 미인증."""
    return await service.history(user.id, month)


@router.get("/me/jeongseong", response_model=JeongseongCurrentResponse)
async def get_jeongseong(
    user: User = Depends(get_current_user),
    service: JeongseongService = Depends(get_jeongseong_service),
) -> JeongseongCurrentResponse:
    """API-HD-009 진행 중인 정성 기간 + 진행률. 없거나 끝났으면(completed 로 정리) period=null. 401 미인증."""
    return await service.get_current(user.id)


@router.post(
    "/me/jeongseong",
    response_model=JeongseongPeriodResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def create_jeongseong(
    data: JeongseongCreate,
    user: User = Depends(get_current_user),
    service: JeongseongService = Depends(get_jeongseong_service),
) -> JeongseongPeriodResponse:
    """API-HD-009 정성 기간 시작. 409 이미 진행 중, 422 검증(주제·기간·시작일 범위), 403 CSRF, 401 미인증."""
    return await service.create(user.id, data)


@router.delete("/me/jeongseong", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def abandon_jeongseong(
    user: User = Depends(get_current_user),
    service: JeongseongService = Depends(get_jeongseong_service),
) -> None:
    """API-HD-009 진행 중인 정성 기간을 그만두기(abandoned). 404 없음, 403 CSRF, 401 미인증."""
    await service.abandon(user.id)
