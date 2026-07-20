"""챗봇 설정 Service."""

import uuid

from fastapi import HTTPException, status

from src.chat.prompt import BASE_SYSTEM_PROMPT
from src.chatbot.models import ChatbotConfig
from src.chatbot.repository import ChatbotRepository
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
    TierConfig,
    WeightedSourceConfig,
)
from src.chatbot.schemas import ChatbotConfigCreate, ChatbotConfigUpdate


class ChatbotService:
    def __init__(self, repo: ChatbotRepository) -> None:
        self.repo = repo

    async def list_active(self) -> list[ChatbotConfig]:
        return await self.repo.list_active()

    async def list_all(self) -> list[ChatbotConfig]:
        return await self.repo.list_all()

    async def list_paginated(
        self, limit: int = 20, offset: int = 0
    ) -> tuple[list[ChatbotConfig], int]:
        """페이지네이션된 전체 목록 + 총 개수."""
        items = await self.repo.list_paginated(limit=limit, offset=offset)
        total = await self.repo.count_all()
        return items, total

    async def get_by_id(self, config_id: uuid.UUID) -> ChatbotConfig:
        """단건 조회. 없으면 404."""
        config = await self.repo.get_by_id(config_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="챗봇 설정을 찾을 수 없습니다",
            )
        return config

    async def get_config_id(self, chatbot_id: str | None) -> uuid.UUID | None:
        """chatbot_id로 DB PK를 조회."""
        if chatbot_id is None:
            return None
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        return config.id if config else None

    async def build_runtime_config(
        self, chatbot_id: str | None
    ) -> ChatbotRuntimeConfig | None:
        """ChatbotConfig → ChatbotRuntimeConfig (불변 단일 객체) 조립.

        chatbot_id is None  → None 반환 (router 측에서 시스템 기본값 분기)
        config 미존재       → HTTPException 404
        빈 system_prompt    → BASE_SYSTEM_PROMPT fallback
        persona_name        → GenerationStage 의 compose_system_prompt 에서 {persona} 치환
        search_tiers JSON   → SearchModeConfig + RetrievalConfig 분리

        audit P1-7 (2026-05-15): 함수 안 lazy import (`from src.chat.prompt`,
        `from src.chatbot.runtime_config`) 를 module-level 로 승격. chat ↔ chatbot
        의존 그래프 점검 결과 `chat.prompt → search.hybrid → leaf` 단방향 OK.
        """
        if chatbot_id is None:
            return None
        record = await self.repo.get_by_chatbot_id(chatbot_id)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"chatbot_id '{chatbot_id}'를 찾을 수 없습니다",
            )

        raw = record.search_tiers or {}
        mode_str = raw.get("search_mode") or raw.get("mode") or "cascading"
        tiers_in = raw.get("tiers", []) or []
        tiers = [
            TierConfig(
                sources=list(t.get("sources", [])),
                min_results=t.get("min_results", 3),
                score_threshold=t.get("score_threshold", 0.1),
            )
            for t in tiers_in
        ]
        weighted_sources_in = raw.get("weighted_sources", []) or []
        weighted_sources = [
            WeightedSourceConfig(
                source=ws.get("source", ""),
                weight=ws.get("weight", 1.0),
                score_threshold=ws.get("score_threshold", 0.1),
            )
            for ws in weighted_sources_in
        ]

        base_prompt = (record.system_prompt or "").strip() or BASE_SYSTEM_PROMPT
        persona = (record.persona_name or "").strip() or None

        return ChatbotRuntimeConfig(
            chatbot_id=record.chatbot_id,
            name=record.display_name,
            search=SearchModeConfig(
                mode=mode_str,
                tiers=tiers,
                weighted_sources=weighted_sources,
            ),
            generation=GenerationConfig(
                system_prompt=base_prompt,
                persona_name=persona,
                # 레드팀 시연 — search_tiers JSONB 의 raw_rag_only 플래그 (마이그레이션 없이 재사용).
                raw_rag_only=raw.get("raw_rag_only", False),
            ),
            retrieval=RetrievalConfig(
                rerank_enabled=raw.get("rerank_enabled", True),
                query_rewrite_enabled=raw.get("query_rewrite_enabled", True),
                # 봇별 멀티턴 토글 (search_tiers JSONB 안에 저장, 마이그레이션 없이 재사용).
                multiturn_enabled=raw.get("multiturn_enabled", True),
            ),
            safety=SafetyConfig(),
            # P1-F: search_tiers JSONB 안에 함께 저장된 신학 입장 텍스트 (선택).
            theological_stance=raw.get("theological_stance"),
        )

    async def create(self, data: ChatbotConfigCreate) -> ChatbotConfig:
        existing = await self.repo.get_by_chatbot_id(data.chatbot_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"chatbot_id '{data.chatbot_id}' 이미 존재합니다",
            )
        # SearchTiersConfig → dict 변환 (JSONB 저장)
        dump = data.model_dump()
        dump["search_tiers"] = dump["search_tiers"] if isinstance(dump["search_tiers"], dict) else data.search_tiers.model_dump()
        config = ChatbotConfig(**dump)
        saved = await self.repo.create(config)
        await self.repo.commit()
        return saved

    async def update(
        self, config_id: uuid.UUID, data: ChatbotConfigUpdate
    ) -> ChatbotConfig:
        config = await self.repo.get_by_id(config_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="챗봇 설정을 찾을 수 없습니다",
            )
        updates = data.model_dump(exclude_unset=True)
        # SearchTiersConfig → dict 변환 (JSONB 저장)
        if "search_tiers" in updates and updates["search_tiers"] is not None:
            st = updates["search_tiers"]
            if not isinstance(st, dict):
                updates["search_tiers"] = data.search_tiers.model_dump()
        updated = await self.repo.update(config, updates)
        await self.repo.commit()
        return updated
