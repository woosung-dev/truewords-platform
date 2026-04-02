"""챗봇 설정 Service."""

import uuid

from fastapi import HTTPException, status

from src.chatbot.models import ChatbotConfig
from src.chatbot.repository import ChatbotRepository
from src.chatbot.schemas import ChatbotConfigCreate, ChatbotConfigUpdate
from src.search.cascading import CascadingConfig, SearchTier


class ChatbotService:
    def __init__(self, repo: ChatbotRepository) -> None:
        self.repo = repo

    async def list_active(self) -> list[ChatbotConfig]:
        return await self.repo.list_active()

    async def list_all(self) -> list[ChatbotConfig]:
        return await self.repo.list_all()

    async def get_cascading_config(self, chatbot_id: str | None) -> CascadingConfig:
        """chatbot_id로 CascadingConfig를 조회. None이면 기본값."""
        if chatbot_id is None:
            return CascadingConfig(
                tiers=[SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.60)]
            )
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        if config is None:
            return CascadingConfig(
                tiers=[SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.60)]
            )
        return self._parse_search_tiers(config.search_tiers)

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
        config = ChatbotConfig(**data.model_dump())
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
                score_threshold=t.get("score_threshold", 0.75),
            )
            for t in tiers_list
        ]
        return CascadingConfig(tiers=tiers)
