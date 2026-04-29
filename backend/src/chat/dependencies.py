"""채팅 DI 조립."""

import asyncio
import logging

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache.service import SemanticCacheService
from src.cache.setup import ensure_cache_collection
from src.chat.repository import ChatRepository
from src.chat.service import ChatService
from src.chatbot.dependencies import get_chatbot_service
from src.chatbot.service import ChatbotService
from src.common.database import get_async_session
logger = logging.getLogger(__name__)

# Lazy init 동시성 가드: 첫 요청 다발 시 ensure를 1회만 실행.
_cache_init_lock = asyncio.Lock()


async def get_chat_repository(
    session: AsyncSession = Depends(get_async_session),
) -> ChatRepository:
    return ChatRepository(session)


async def get_cache_service(request: Request) -> SemanticCacheService | None:
    """Cache가 unavailable이면 None 반환 (graceful degradation).

    Lazy init: app.state.cache_available 가
      - None : 아직 시도 전 → 잠금 획득 후 ensure 시도, 결과 캐싱
      - True : 가용 → SemanticCacheService 반환
      - False: 시도했으나 실패 → None 반환 (영속, 다음 cold start까지)

    NOTE: lifespan에서 ensure_cache_collection을 호출하지 않는 이유는
    main.py 의 lifespan docstring 및 dev-log/46 참고.
    """
    state = request.app.state
    if getattr(state, "cache_available", None) is None:
        async with _cache_init_lock:
            if getattr(state, "cache_available", None) is None:
                try:
                    await ensure_cache_collection()
                    state.cache_available = True
                    logger.info("캐시 컬렉션 lazy init 성공 — cache_available=True")
                except Exception as e:
                    logger.warning(
                        "캐시 컬렉션 lazy init 실패 — graceful degradation으로 동작: %r",
                        e,
                        exc_info=True,
                    )
                    state.cache_available = False

    if not state.cache_available:
        return None
    return SemanticCacheService()


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
