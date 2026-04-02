"""챗봇 설정 Repository."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.chatbot.models import ChatbotConfig


class ChatbotRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_chatbot_id(self, chatbot_id: str) -> ChatbotConfig | None:
        result = await self.session.execute(
            select(ChatbotConfig).where(ChatbotConfig.chatbot_id == chatbot_id)
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, config_id: uuid.UUID) -> ChatbotConfig | None:
        result = await self.session.execute(
            select(ChatbotConfig).where(ChatbotConfig.id == config_id)
        )
        return result.scalar_one_or_none()

    async def list_active(self) -> list[ChatbotConfig]:
        result = await self.session.execute(
            select(ChatbotConfig).where(ChatbotConfig.is_active == True)
        )
        return list(result.scalars().all())

    async def list_all(self) -> list[ChatbotConfig]:
        result = await self.session.execute(select(ChatbotConfig))
        return list(result.scalars().all())

    async def list_paginated(
        self, limit: int = 20, offset: int = 0
    ) -> list[ChatbotConfig]:
        """페이지네이션 목록 조회 (created_at DESC)."""
        result = await self.session.execute(
            select(ChatbotConfig)
            .order_by(ChatbotConfig.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    async def count_all(self) -> int:
        """전체 챗봇 설정 개수."""
        result = await self.session.execute(
            select(func.count()).select_from(ChatbotConfig)
        )
        return result.scalar_one()

    async def create(self, config: ChatbotConfig) -> ChatbotConfig:
        self.session.add(config)
        await self.session.flush()
        return config

    async def update(
        self, config: ChatbotConfig, updates: dict
    ) -> ChatbotConfig:
        for key, value in updates.items():
            if value is not None:
                setattr(config, key, value)
        # DB 기존 데이터가 naive datetime이므로 naive UTC 유지 (asyncpg 호환)
        config.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await self.session.flush()
        return config

    async def commit(self) -> None:
        await self.session.commit()
