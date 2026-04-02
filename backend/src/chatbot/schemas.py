"""챗봇 설정 Pydantic 스키마."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class ChatbotConfigResponse(BaseModel):
    id: uuid.UUID
    chatbot_id: str
    display_name: str
    description: str
    system_prompt_version: str | None
    search_tiers: dict
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ChatbotConfigCreate(BaseModel):
    chatbot_id: str
    display_name: str
    description: str = ""
    system_prompt_version: str | None = None
    search_tiers: dict = {}
    is_active: bool = True


class ChatbotConfigUpdate(BaseModel):
    display_name: str | None = None
    description: str | None = None
    system_prompt_version: str | None = None
    search_tiers: dict | None = None
    is_active: bool | None = None
