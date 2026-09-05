"""챗봇 설정 Repository."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.chatbot.models import ChatbotConfig


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

    async def get_top_queries_for_bot(
        self,
        chatbot_config_id: uuid.UUID,
        days: int = 30,
        limit: int = 10,
    ) -> list[dict]:
        """특정 봇에 들어온 최근 N일 질문 top-N (counts).

        cron job 의 추천 질문 생성을 위해 사용. user role 메시지 기준으로 봇별 필터.
        analytics_repository.get_top_queries 와 달리 chatbot_config_id 로 격리.
        """
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await self.session.execute(
            text(
                """
                SELECT sm.content AS query_text, COUNT(*) AS count
                FROM session_messages sm
                JOIN research_sessions rs ON rs.id = sm.session_id
                WHERE rs.chatbot_config_id = :bot_id
                  AND sm.role = 'USER'
                  AND sm.created_at >= :cutoff
                GROUP BY sm.content
                ORDER BY count DESC, sm.content
                LIMIT :limit
                """
            ),
            {"bot_id": chatbot_config_id, "cutoff": cutoff, "limit": limit},
        )
        return [
            {"query_text": row.query_text, "count": row.count}
            for row in result.all()
        ]

    async def update_suggested_questions(
        self,
        config: ChatbotConfig,
        questions: list[str],
    ) -> ChatbotConfig:
        """추천 질문 + 갱신 시각 저장. cron job 전용."""
        config.suggested_questions = questions
        config.suggested_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await self.session.flush()
        return config
