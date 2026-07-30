"""채팅 DI 조립."""

import asyncio
import logging
import time
import uuid

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.auth import decode_access_token
# 대화 기록 목록/단건 열람은 admin JWT 인증을 재사용 (라우터가 chat.dependencies 에서 임포트).
from src.admin.dependencies import get_current_admin  # noqa: F401
from src.cache.service import SemanticCacheService
from src.cache.setup import ensure_cache_collection
from src.chat.reactions_repository import MessageReactionRepository
from src.chat.reactions_service import MessageReactionService
from src.chat.repository import ChatRepository
from src.chat.service import ChatService
from src.chatbot.dependencies import get_chatbot_service
from src.chatbot.service import ChatbotService
from src.common.database import get_async_session
from src.common.ingestion_facade import IngestionJobRepository, make_ingestion_repo  # audit 2차 B-1 — pipeline.ingestion_repository 직접 import 제거
logger = logging.getLogger(__name__)

# Lazy init 동시성 가드: 첫 요청 다발 시 ensure를 1회만 실행.
_cache_init_lock = asyncio.Lock()
_CACHE_RETRY_COOLDOWN_SEC = 300.0
_cache_last_failure_monotonic: float | None = None


async def get_chat_repository(
    session: AsyncSession = Depends(get_async_session),
) -> ChatRepository:
    return ChatRepository(session)


async def get_reactions_repository(
    session: AsyncSession = Depends(get_async_session),
) -> MessageReactionRepository:
    return MessageReactionRepository(session)


async def get_reactions_service(
    repo: MessageReactionRepository = Depends(get_reactions_repository),
) -> MessageReactionService:
    return MessageReactionService(repo)


async def get_ingestion_repository(
    session: AsyncSession = Depends(get_async_session),
) -> IngestionJobRepository:
    """Cache invalidation 의 corpus_updated_at trigger 조회용.

    cross-domain 조회 전용 — chat 측은 max(completed_at) 만 사용한다.
    audit 2차 B-1: facade factory 경유 — pipeline 인스턴스화 책임 격리.
    """
    return make_ingestion_repo(session)


async def get_cache_service(request: Request) -> SemanticCacheService | None:
    """Cache가 unavailable이면 None 반환 (graceful degradation).

    Lazy init: app.state.cache_available 가
      - None : 아직 시도 전 → 잠금 획득 후 ensure 시도, 결과 캐싱
      - True : 가용 → SemanticCacheService 반환
      - False: 시도 실패 → 쿨다운 후 재시도, 그전에는 None 반환.

    NOTE: lifespan에서 ensure_cache_collection을 호출하지 않는 이유는
    main.py 의 lifespan docstring 및 dev-log/46 참고.
    """
    global _cache_last_failure_monotonic
    state = request.app.state
    # 장수 프로세스에서 일시적 Qdrant 장애로 캐시가 영구 비활성화되지 않도록 쿨다운 후 재시도한다.
    if (
        getattr(state, "cache_available", None) is False
        and _cache_last_failure_monotonic is not None
        and time.monotonic() - _cache_last_failure_monotonic >= _CACHE_RETRY_COOLDOWN_SEC
    ):
        state.cache_available = None
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
                    _cache_last_failure_monotonic = time.monotonic()

    if not state.cache_available:
        return None
    return SemanticCacheService()


async def get_chat_service(
    chat_repo: ChatRepository = Depends(get_chat_repository),
    chatbot_service: ChatbotService = Depends(get_chatbot_service),
    cache_service: SemanticCacheService | None = Depends(get_cache_service),
    ingestion_repo: IngestionJobRepository = Depends(get_ingestion_repository),
) -> ChatService:
    return ChatService(
        chat_repo=chat_repo,
        chatbot_service=chatbot_service,
        cache_service=cache_service,
        ingestion_repo=ingestion_repo,
    )


async def get_optional_user_id(request: Request) -> uuid.UUID | None:
    """admin_token 쿠키가 유효하면 사용자 id, 아니면 None.

    채팅은 익명 허용이므로 인증 실패해도 401 을 내지 않는다. 로그인 상태면
    세션을 사용자에게 귀속시켜 대화 기록 목록 조회 대상으로 만든다.
    """
    token = request.cookies.get("admin_token")
    if not token:
        return None
    payload = decode_access_token(token)
    if payload is None:
        return None
    sub = payload.get("sub")
    if not sub:
        return None
    try:
        return uuid.UUID(sub)
    except ValueError:
        return None
