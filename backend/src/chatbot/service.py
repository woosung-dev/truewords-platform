"""챗봇 설정 Service."""

import uuid

from fastapi import HTTPException, status

from src.chatbot.models import ChatbotConfig
from src.chatbot.repository import ChatbotRepository
from src.chatbot.schemas import ChatbotConfigCreate, ChatbotConfigUpdate, SearchTiersConfig
from src.search.cascading import CascadingConfig, SearchTier

# 단일 기본값 상수 (DRY)
# RRF fusion 점수는 일반적으로 0.0~0.5 범위 (코사인 유사도 스케일이 아님)
DEFAULT_CASCADING_CONFIG = CascadingConfig(
    tiers=[SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.1)]
)
DEFAULT_RERANK_ENABLED = False


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

    async def get_cascading_config(self, chatbot_id: str | None) -> CascadingConfig:
        """chatbot_id로 CascadingConfig를 조회. None이면 기본값, 미존재 시 404."""
        if chatbot_id is None:
            return DEFAULT_CASCADING_CONFIG
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"chatbot_id '{chatbot_id}'를 찾을 수 없습니다",
            )
        return self._parse_search_tiers(config.search_tiers)

    async def get_search_config(self, chatbot_id: str | None) -> tuple[CascadingConfig, bool]:
        """chatbot_id로 CascadingConfig + rerank_enabled를 조회."""
        if chatbot_id is None:
            return DEFAULT_CASCADING_CONFIG, DEFAULT_RERANK_ENABLED
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"chatbot_id '{chatbot_id}'를 찾을 수 없습니다",
            )
        cascading = self._parse_search_tiers(config.search_tiers)
        rerank_enabled = config.search_tiers.get("rerank_enabled", DEFAULT_RERANK_ENABLED)
        return cascading, rerank_enabled

    async def get_config_id(self, chatbot_id: str | None) -> uuid.UUID | None:
        """chatbot_id로 DB PK를 조회."""
        if chatbot_id is None:
            return None
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        return config.id if config else None

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

    @staticmethod
    def _parse_search_tiers(tiers_data: dict) -> CascadingConfig:
        """JSONB search_tiers → CascadingConfig 변환."""
        tiers_list = tiers_data.get("tiers", [])
        tiers = [
            SearchTier(
                sources=t["sources"],
                min_results=t.get("min_results", 3),
                score_threshold=t.get("score_threshold", 0.1),
            )
            for t in tiers_list
        ]
        return CascadingConfig(tiers=tiers)
