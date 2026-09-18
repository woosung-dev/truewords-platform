"""훈독 편성 admin 라우터 — /admin/hoondok/daily-readings (API-HD-006~008, PLAN-HD-001 Phase 3 A).

main.py 의 관리자 블록에 `_ADMIN_GATE`(require_admin_gate) 로 등록한다. 상태 변경은 라우터 레벨 verify_csrf.
편성자는 비개발자(결정 2026-09-19) — 이 API 위에 apps/admin 편성 화면(sub-PR B)이 올라간다.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, status

from app.modules.admin.dependencies import get_admin_service, get_current_admin, verify_csrf
from app.modules.admin.service import AdminService
from app.modules.hoondok.dependencies import get_daily_reading_admin_service
from app.modules.hoondok.schemas import (
    DailyReadingAdminCreate,
    DailyReadingAdminResponse,
    DailyReadingAdminUpdate,
)
from app.modules.hoondok.service import DailyReadingAdminService

admin_router = APIRouter(
    prefix="/admin/hoondok/daily-readings",
    tags=["admin-hoondok"],
    dependencies=[Depends(verify_csrf)],
)

TARGET_TABLE = "daily_readings"


@admin_router.get("", response_model=list[DailyReadingAdminResponse])
async def list_daily_readings(
    from_: date | None = Query(default=None, alias="from", description="시작일(KST). 기본 오늘"),
    to: date | None = Query(default=None, description="종료일(포함). 기본 시작일 +14일"),
    service: DailyReadingAdminService = Depends(get_daily_reading_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[DailyReadingAdminResponse]:
    """API-HD-006 편성 목록. 날짜 오름차순, 편성 없는 날은 행이 없다. 422 종료일 < 시작일 또는 366일 초과."""
    readings = await service.list(from_, to)
    return [DailyReadingAdminResponse.model_validate(r, from_attributes=True) for r in readings]


@admin_router.get("/{reading_id}", response_model=DailyReadingAdminResponse)
async def get_daily_reading(
    reading_id: uuid.UUID,
    service: DailyReadingAdminService = Depends(get_daily_reading_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> DailyReadingAdminResponse:
    """API-HD-006 편성 단건. 404 없음."""
    return DailyReadingAdminResponse.model_validate(await service.get(reading_id), from_attributes=True)


@admin_router.post("", response_model=DailyReadingAdminResponse, status_code=status.HTTP_201_CREATED)
async def create_daily_reading(
    data: DailyReadingAdminCreate,
    service: DailyReadingAdminService = Depends(get_daily_reading_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> DailyReadingAdminResponse:
    """API-HD-007 편성 등록. 201 · 409 같은 날짜 · 422 검증."""
    reading = await service.create(data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="daily_reading.create",
        target_table=TARGET_TABLE,
        target_id=reading.id,
        changes=data.model_dump(mode="json"),
    )
    return DailyReadingAdminResponse.model_validate(reading, from_attributes=True)


@admin_router.put("/{reading_id}", response_model=DailyReadingAdminResponse)
async def update_daily_reading(
    reading_id: uuid.UUID,
    data: DailyReadingAdminUpdate,
    service: DailyReadingAdminService = Depends(get_daily_reading_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> DailyReadingAdminResponse:
    """API-HD-008 편성 수정(보낸 필드만). `review_status=withdrawn` 이 철회. 404 없음 · 409 날짜 충돌."""
    reading = await service.update(reading_id, data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="daily_reading.update",
        target_table=TARGET_TABLE,
        target_id=reading_id,
        changes=data.model_dump(exclude_unset=True, mode="json"),
    )
    return DailyReadingAdminResponse.model_validate(reading, from_attributes=True)
