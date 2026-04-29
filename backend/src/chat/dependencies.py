"""채팅 DI 조립."""

import logging

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache.service import SemanticCacheService
from src.chat.repository import ChatRepository
from src.chat.service import ChatService
from src.chatbot.dependencies import get_chatbot_service
from src.chatbot.service import ChatbotService
from src.common.database import get_async_session

logger = logging.getLogger(__name__)


async def get_chat_repository(
    session: AsyncSession = Depends(get_async_session),
) -> ChatRepository:
    return ChatRepository(session)


async def get_cache_service() -> SemanticCacheService | None:
    """[HOTFIX] Cache 영구 비활성 — 모든 요청에 None 반환.

    이유: PR #80 머지 후 SemanticCacheService.check_cache 가 qdrant-client SDK
    HTTP/2 hang으로 chat 500 발생. PR #79 lazy init도 첫 chat 60s block 문제 잔존.
    SemanticCacheService 전체를 raw httpx 로 전환하는 후속 PR 까지 임시 비활성.

    상세: docs/dev-log/46-qdrant-cache-cold-start-debug.md (Phase 5-D)
    """
    return None


async def get_chat_service(
    chat_repo: ChatRepository = Depends(get_chat_repository),
    chatbot_service: ChatbotService = Depends(get_chatbot_service),
    cache_service: SemanticCacheService | None = Depends(get_cache_service),
) -> ChatService:
    return ChatService(
        chat_repo=chat_repo,
        chatbot_service=chatbot_service,
        cache_service=cache_service,
    )
