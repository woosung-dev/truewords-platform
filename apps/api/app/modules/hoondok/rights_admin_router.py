"""권리 운영: 관리자 게이트·CSRF·감사 기록을 편성과 동일하게 적용한다."""

import uuid

from fastapi import APIRouter, Depends

from app.modules.admin.dependencies import (
    get_admin_service,
    get_current_admin,
    verify_csrf,
)
from app.modules.admin.service import AdminService
from app.modules.hoondok.dependencies import get_journey_service
from app.modules.hoondok.journey_schemas import ContentRightInput, ContentRightResponse
from app.modules.hoondok.journey_service import JourneyService

router = APIRouter(
    prefix="/admin/hoondok/content-rights",
    tags=["admin-hoondok"],
    dependencies=[Depends(verify_csrf)],
)


@router.get("", response_model=list[ContentRightResponse])
async def list_content_rights(
    service: JourneyService = Depends(get_journey_service),
    admin: dict = Depends(get_current_admin),
) -> list[ContentRightResponse]:
    return [
        ContentRightResponse.model_validate(r) for r in await service.list_rights()
    ]


@router.post("", response_model=ContentRightResponse, status_code=201)
async def create_content_right(
    data: ContentRightInput,
    service: JourneyService = Depends(get_journey_service),
    audit: AdminService = Depends(get_admin_service),
    admin: dict = Depends(get_current_admin),
) -> ContentRightResponse:
    right = await service.save_right(data)
    await audit.log_audit(
        admin_user_id=admin["user_id"],
        action="content_right.create",
        target_table="content_rights",
        target_id=right.id,
        changes=data.model_dump(mode="json"),
    )
    return ContentRightResponse.model_validate(right)


@router.put("/{right_id}", response_model=ContentRightResponse)
async def update_content_right(
    right_id: uuid.UUID,
    data: ContentRightInput,
    service: JourneyService = Depends(get_journey_service),
    audit: AdminService = Depends(get_admin_service),
    admin: dict = Depends(get_current_admin),
) -> ContentRightResponse:
    right = await service.save_right(data, right_id)
    await audit.log_audit(
        admin_user_id=admin["user_id"],
        action="content_right.update",
        target_table="content_rights",
        target_id=right.id,
        changes=data.model_dump(mode="json"),
    )
    return ContentRightResponse.model_validate(right)
