"""훈독 모임 admin 라우터 — API-HD-042 공식 정성 · API-HD-043 모임 목록·삭제 (PLAN-HD-010).

main.py 관리자 블록에 `_ADMIN_GATE` 로 등록한다. 상태 변경은 라우터 레벨 verify_csrf, 변경마다 log_audit.
모임 목록은 이름·인원·생성일만 — 모임원 이름·한 줄 본문은 admin 에게도 내지 않는다.
"""

import uuid

from fastapi import APIRouter, Depends, status

from app.modules.admin.dependencies import get_admin_service, get_current_admin, verify_csrf
from app.modules.admin.service import AdminService
from app.modules.hoondok.dependencies import get_group_admin_service
from app.modules.hoondok.groups_schemas import AdminGroupItem, OfficialJeongseongInput, OfficialJeongseongOut
from app.modules.hoondok.groups_service import GroupAdminService

jeongseong_admin_router = APIRouter(
    prefix="/admin/hoondok/jeongseongs",
    tags=["admin-hoondok"],
    dependencies=[Depends(verify_csrf)],
)
groups_admin_router = APIRouter(
    prefix="/admin/hoondok/groups",
    tags=["admin-hoondok"],
    dependencies=[Depends(verify_csrf)],
)

JEONGSEONG_TABLE = "shared_jeongseongs"
GROUP_TABLE = "reading_groups"


@jeongseong_admin_router.get("", response_model=list[OfficialJeongseongOut])
async def list_official_jeongseongs(
    service: GroupAdminService = Depends(get_group_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[OfficialJeongseongOut]:
    """API-HD-042 공식 정성 목록(시작일 내림차순). 진행 상태는 화면이 started_on·duration_days 로 계산한다."""
    return await service.list_official()


@jeongseong_admin_router.post("", response_model=OfficialJeongseongOut, status_code=status.HTTP_201_CREATED)
async def create_official_jeongseong(
    data: OfficialJeongseongInput,
    service: GroupAdminService = Depends(get_group_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> OfficialJeongseongOut:
    """API-HD-042 공식 정성 등록 → 201. 모든 모임 상세에 자동 표시된다."""
    created = await service.create_official(data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="official_jeongseong.create",
        target_table=JEONGSEONG_TABLE,
        target_id=created.id,
        changes=data.model_dump(mode="json"),
    )
    return created


@jeongseong_admin_router.put("/{jeongseong_id}", response_model=OfficialJeongseongOut)
async def update_official_jeongseong(
    jeongseong_id: uuid.UUID,
    data: OfficialJeongseongInput,
    service: GroupAdminService = Depends(get_group_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> OfficialJeongseongOut:
    """API-HD-042 공식 정성 수정(전체 교체). 404 없음·모임 정성."""
    updated = await service.update_official(jeongseong_id, data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="official_jeongseong.update",
        target_table=JEONGSEONG_TABLE,
        target_id=jeongseong_id,
        changes=data.model_dump(mode="json"),
    )
    return updated


@jeongseong_admin_router.delete("/{jeongseong_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_official_jeongseong(
    jeongseong_id: uuid.UUID,
    service: GroupAdminService = Depends(get_group_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> None:
    """API-HD-042 공식 정성 삭제 → 204. 404 없음·모임 정성."""
    await service.delete_official(jeongseong_id)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="official_jeongseong.delete",
        target_table=JEONGSEONG_TABLE,
        target_id=jeongseong_id,
        changes={},
    )


@groups_admin_router.get("", response_model=list[AdminGroupItem])
async def list_groups(
    service: GroupAdminService = Depends(get_group_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[AdminGroupItem]:
    """API-HD-043 모임 목록 — id·name·member_count·created_at 만."""
    return await service.list_groups()


@groups_admin_router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: uuid.UUID,
    service: GroupAdminService = Depends(get_group_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> None:
    """API-HD-043 모임 삭제(신고 대응) → 204 + 감사 로그. 404 없음."""
    await service.delete_group(group_id)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="reading_group.delete",
        target_table=GROUP_TABLE,
        target_id=group_id,
        changes={},
    )
