"""챗봇 DI 조립."""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.chatbot.repository import ChatbotRepository
from src.chatbot.service import ChatbotService
from src.common.database import get_async_session


async def get_chatbot_repository(
    session: AsyncSession = Depends(get_async_session),
) -> ChatbotRepository:
    return ChatbotRepository(session)


async def get_chatbot_service(
    repo: ChatbotRepository = Depends(get_chatbot_repository),
) -> ChatbotService:
    return ChatbotService(repo)
