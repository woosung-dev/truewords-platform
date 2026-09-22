"""권리 운영: 관리자 게이트·CSRF·감사 기록을 편성과 동일하게 적용한다."""

import uuid

from fastapi import APIRouter, Depends

from app.modules.admin.dependencies import (
    get_admin_service,
    get_current_admin,
    verify_csrf,
)
from app.modules.admin.service import AdminService
from app.modules.hoondok.dependencies import get_journey_service, get_library_service
from app.modules.hoondok.journey_schemas import ContentRightInput, ContentRightResponse
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.library_schemas import (
    BulkRightsInput,
    BulkRightsResponse,
    SeriesSummaryResponse,
)
from app.modules.hoondok.library_service import LibraryService

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


@router.post("/bulk", response_model=BulkRightsResponse)
async def bulk_update_content_rights(
    data: BulkRightsInput,
    service: LibraryService = Depends(get_library_service),
    audit: AdminService = Depends(get_admin_service),
    admin: dict = Depends(get_current_admin),
) -> BulkRightsResponse:
    """API-HD-027 시리즈 일괄 승인·철회. 등급은 준 경우에만 바꾸고 감사 로그는 1건만 남긴다."""
    result, target_id = await service.bulk_update(data)
    await audit.log_audit(
        admin_user_id=admin["user_id"],
        action="content_right.bulk",
        target_table="content_rights",
        target_id=target_id,  # 시리즈 대표 행 — 실제 범위는 changes 의 book_series·updated 가 갖는다
        changes={**data.model_dump(mode="json"), "updated": result.updated},
    )
    return result


@router.get("/series", response_model=SeriesSummaryResponse)
async def get_series_summary(
    service: LibraryService = Depends(get_library_service),
    admin: dict = Depends(get_current_admin),
) -> SeriesSummaryResponse:
    """API-HD-028 시리즈별 등록·허용·대기·철회 수와 청크 합. 조회라 감사 로그를 남기지 않는다."""
    return await service.series_summary()


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
