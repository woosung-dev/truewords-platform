"""채팅 DI 조립."""

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache.service import SemanticCacheService
from src.chat.repository import ChatRepository
from src.chat.service import ChatService
from src.chatbot.dependencies import get_chatbot_service
from src.chatbot.service import ChatbotService
from src.common.database import get_async_session
from src.qdrant_client import get_async_client


async def get_chat_repository(
    session: AsyncSession = Depends(get_async_session),
) -> ChatRepository:
    return ChatRepository(session)


async def get_cache_service(request: Request) -> SemanticCacheService | None:
    """Cache가 unavailable이면 None 반환.

    ChatService.cache_service는 이미 Optional이고 모든 호출부에
    `if self.cache_service:` 가드가 있으므로 None을 그대로 전달하면
    graceful degradation이 자동으로 동작한다.
    """
    if not getattr(request.app.state, "cache_available", True):
        return None
    return SemanticCacheService(get_async_client())


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
