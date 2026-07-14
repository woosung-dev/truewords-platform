"""챗봇 설정 Pydantic 스키마."""

import uuid
from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


# --- search_tiers 타입 검증 ---


class SearchTierSchema(BaseModel):
    """개별 검색 티어 설정."""

    sources: list[str] = Field(min_length=1)
    min_results: int = Field(ge=1, le=20, default=3)
    # RRF fusion 점수 기준 (일반적으로 0.0~0.5 범위)
    score_threshold: float = Field(ge=0.0, le=1.0, default=0.1)


class WeightedSourceSchema(BaseModel):
    """Weighted 검색 소스별 비중 설정."""

    source: str
    weight: float = Field(ge=0.1, le=100, default=1)
    score_threshold: float = Field(ge=0.0, le=1.0, default=0.1)


class SearchTiersConfig(BaseModel):
    """search_tiers JSONB 구조."""

    search_mode: Literal["cascading", "weighted"] = "cascading"
    tiers: list[SearchTierSchema] = Field(default_factory=list)
    weighted_sources: list[WeightedSourceSchema] = Field(default_factory=list)
    rerank_enabled: bool = False
    dictionary_enabled: bool = False
    query_rewrite_enabled: bool = False
    # 봇별 멀티턴(대화 이력) 토글. 기본 ON — 기존 봇은 이 키가 없어도 멀티턴 유지.
    multiturn_enabled: bool = True
    # 레드팀 시연 — RAG-only 대조군 봇. True 면 시스템 프롬프트(BASE·모드모듈) 전부
    # 우회하고 빈 system_instruction 으로 생성. build_runtime_config 가 읽어 GenerationConfig 로 전달.
    raw_rag_only: bool = False


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
    system_prompt: str
    persona_name: str
    search_tiers: SearchTiersConfig
    is_active: bool
    streaming_enabled: bool
    # 입력 화면 추천 질문 칩 (봇별, 비어있으면 프론트가 fallback prompts 사용)
    suggested_questions: list[str] = Field(default_factory=list)
    suggested_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ChatbotConfigCreate(BaseModel):
    chatbot_id: str
    display_name: str
    description: str = ""
    system_prompt: str = ""
    persona_name: str = ""
    search_tiers: SearchTiersConfig = Field(
        default_factory=lambda: SearchTiersConfig(tiers=[])
    )
    is_active: bool = True
    streaming_enabled: bool = True


class ChatbotConfigUpdate(BaseModel):
    display_name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    persona_name: str | None = None
    search_tiers: SearchTiersConfig | None = None
    is_active: bool | None = None
    streaming_enabled: bool | None = None
