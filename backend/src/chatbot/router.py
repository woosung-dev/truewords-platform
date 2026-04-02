"""챗봇 공개 API 라우터."""

import uuid

from fastapi import APIRouter, Depends, Request

from src.admin.dependencies import get_admin_service, get_current_admin
from src.admin.service import AdminService
from src.chatbot.dependencies import get_chatbot_service
from src.chatbot.schemas import (
    ChatbotConfigCreate,
    ChatbotConfigResponse,
    ChatbotConfigUpdate,
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


@admin_router.get("", response_model=list[ChatbotConfigResponse])
async def list_all_configs(
    service: ChatbotService = Depends(get_chatbot_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[ChatbotConfigResponse]:
    configs = await service.list_all()
    return [ChatbotConfigResponse.model_validate(c, from_attributes=True) for c in configs]


@admin_router.post("", response_model=ChatbotConfigResponse, status_code=201)
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
        changes=data.model_dump(),
    )
    return ChatbotConfigResponse.model_validate(config, from_attributes=True)


@admin_router.put("/{config_id}", response_model=ChatbotConfigResponse)
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
        changes=data.model_dump(exclude_unset=True),
    )
    return ChatbotConfigResponse.model_validate(config, from_attributes=True)
