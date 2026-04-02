"""챗봇 공개 API 라우터."""

import uuid

from fastapi import APIRouter, Depends, Query, Request

from src.admin.dependencies import get_admin_service, get_current_admin, verify_csrf
from src.admin.service import AdminService
from src.chatbot.dependencies import get_chatbot_service
from src.chatbot.schemas import (
    ChatbotConfigCreate,
    ChatbotConfigResponse,
    ChatbotConfigUpdate,
    PaginatedResponse,
)
from src.chatbot.service import ChatbotService

router = APIRouter(tags=["chatbot"])


@router.get("/chatbots", response_model=list[ChatbotConfigResponse])
async def list_chatbots(
    service: ChatbotService = Depends(get_chatbot_service),
) -> list[ChatbotConfigResponse]:
    """활성화된 챗봇 목록 조회 (공개)."""
    configs = await service.list_active()
    return [ChatbotConfigResponse.model_validate(c, from_attributes=True) for c in configs]


# --- 관리자 전용 ---

admin_router = APIRouter(prefix="/admin/chatbot-configs", tags=["admin-chatbot"])


@admin_router.get("", response_model=PaginatedResponse[ChatbotConfigResponse])
async def list_all_configs(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    service: ChatbotService = Depends(get_chatbot_service),
    current_admin: dict = Depends(get_current_admin),
) -> PaginatedResponse[ChatbotConfigResponse]:
    """챗봇 설정 목록 조회 (페이지네이션, created_at DESC)."""
    items, total = await service.list_paginated(limit=limit, offset=offset)
    return PaginatedResponse(
        items=[ChatbotConfigResponse.model_validate(c, from_attributes=True) for c in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@admin_router.get("/{config_id}", response_model=ChatbotConfigResponse)
async def get_config(
    config_id: uuid.UUID,
    service: ChatbotService = Depends(get_chatbot_service),
    current_admin: dict = Depends(get_current_admin),
) -> ChatbotConfigResponse:
    """챗봇 설정 단건 조회."""
    config = await service.get_by_id(config_id)
    return ChatbotConfigResponse.model_validate(config, from_attributes=True)


@admin_router.post("", response_model=ChatbotConfigResponse, status_code=201, dependencies=[Depends(verify_csrf)])
async def create_config(
    data: ChatbotConfigCreate,
    service: ChatbotService = Depends(get_chatbot_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> ChatbotConfigResponse:
    config = await service.create(data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="chatbot_config.create",
        target_table="chatbot_configs",
        target_id=config.id,
        changes=data.model_dump(mode="json"),
    )
    return ChatbotConfigResponse.model_validate(config, from_attributes=True)


@admin_router.put("/{config_id}", response_model=ChatbotConfigResponse, dependencies=[Depends(verify_csrf)])
async def update_config(
    config_id: uuid.UUID,
    data: ChatbotConfigUpdate,
    service: ChatbotService = Depends(get_chatbot_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> ChatbotConfigResponse:
    config = await service.update(config_id, data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="chatbot_config.update",
        target_table="chatbot_configs",
        target_id=config_id,
        changes=data.model_dump(exclude_unset=True, mode="json"),
    )
    return ChatbotConfigResponse.model_validate(config, from_attributes=True)
