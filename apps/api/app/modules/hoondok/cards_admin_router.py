"""오늘의 책갈피 admin 라우터 — /admin/hoondok/cards (API-HD-052, PLAN-HD-012).

main.py 관리자 블록에 `_ADMIN_GATE` 로 등록한다. 상태 변경은 라우터 레벨 verify_csrf, 변경마다 log_audit.
본문(`text`)은 원문 그대로라 등록 뒤 바꾸지 않는다 — PATCH 는 status·pinned_on 만 받는다.
"""

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.modules.admin.dependencies import get_admin_service, get_current_admin, verify_csrf
from app.modules.admin.service import AdminService
from app.modules.hoondok.cards_schemas import (
    CardAdminCreate,
    CardAdminItem,
    CardAdminListResponse,
    CardAdminUpdate,
    CardStatus,
)
from app.modules.hoondok.cards_service import CardAdminService
from app.modules.hoondok.dependencies import get_card_admin_service

cards_admin_router = APIRouter(
    prefix="/admin/hoondok/cards",
    tags=["admin-hoondok"],
    dependencies=[Depends(verify_csrf)],
)

TARGET_TABLE = "word_cards"


@cards_admin_router.get("", response_model=CardAdminListResponse)
async def list_cards(
    status_filter: CardStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    service: CardAdminService = Depends(get_card_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> CardAdminListResponse:
    """API-HD-052 카드 풀 목록(최신 등록순). `status` 로 거른다."""
    return await service.list(status_filter, page, page_size)


@cards_admin_router.post("", response_model=CardAdminItem, status_code=status.HTTP_201_CREATED)
async def create_card(
    data: CardAdminCreate,
    service: CardAdminService = Depends(get_card_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> CardAdminItem:
    """API-HD-052 카드 등록 → 201. 409 같은 날짜 고정, 422 검증."""
    created = await service.create(data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="word_card.create",
        target_table=TARGET_TABLE,
        target_id=created.id,
        changes=data.model_dump(mode="json"),
    )
    return created


@cards_admin_router.patch("/{card_id}", response_model=CardAdminItem)
async def update_card(
    card_id: uuid.UUID,
    data: CardAdminUpdate,
    service: CardAdminService = Depends(get_card_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> CardAdminItem:
    """API-HD-052 활성화·중지(status)·날짜 고정(pinned_on, null 이면 해제). 404 없음, 409 날짜 충돌, 422 그 밖의 필드(text 포함)."""
    updated = await service.update(card_id, data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="word_card.update",
        target_table=TARGET_TABLE,
        target_id=card_id,
        changes=data.model_dump(exclude_unset=True, mode="json"),
    )
    return updated
