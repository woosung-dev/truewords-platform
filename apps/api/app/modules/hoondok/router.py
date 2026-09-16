"""훈독 공개 API 라우터 — /hoondok/* (인증 없음, admin 게이트 미적용)."""

from fastapi import APIRouter, Depends

from app.modules.hoondok.dependencies import get_hoondok_service
from app.modules.hoondok.schemas import TodayReadingResponse
from app.modules.hoondok.service import HoondokService

router = APIRouter(prefix="/hoondok", tags=["hoondok"])


@router.get("/today", response_model=TodayReadingResponse)
async def get_today(
    service: HoondokService = Depends(get_hoondok_service),
) -> TodayReadingResponse:
    """API-HD-001 오늘(KST) 말씀. 없으면 status=none, 철회면 withdrawn — 항상 200."""
    return await service.get_today()
