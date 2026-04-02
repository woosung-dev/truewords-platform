"""챗봇 설정 Pydantic 스키마."""

import uuid
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


# --- search_tiers 타입 검증 ---


class SearchTierSchema(BaseModel):
    """개별 검색 티어 설정."""

    sources: list[str] = Field(min_length=1)
    min_results: int = Field(ge=1, le=20, default=3)
    score_threshold: float = Field(ge=0.0, le=1.0, default=0.75)


class SearchTiersConfig(BaseModel):
    """search_tiers JSONB 구조."""

    tiers: list[SearchTierSchema] = Field(default_factory=list)


# --- 페이지네이션 ---


class PaginatedResponse(BaseModel, Generic[T]):
    """페이지네이션 응답 래퍼."""

    items: list[T]
    total: int
    limit: int
    offset: int


# --- 챗봇 설정 CRUD 스키마 ---


class ChatbotConfigResponse(BaseModel):
    id: uuid.UUID
    chatbot_id: str
    display_name: str
    description: str
    system_prompt_version: str | None
    search_tiers: SearchTiersConfig
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ChatbotConfigCreate(BaseModel):
    chatbot_id: str
    display_name: str
    description: str = ""
    system_prompt_version: str | None = None
    search_tiers: SearchTiersConfig = Field(
        default_factory=lambda: SearchTiersConfig(tiers=[])
    )
    is_active: bool = True


class ChatbotConfigUpdate(BaseModel):
    display_name: str | None = None
    description: str | None = None
    system_prompt_version: str | None = None
    search_tiers: SearchTiersConfig | None = None
    is_active: bool | None = None
