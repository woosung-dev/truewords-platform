import logging
from contextlib import asynccontextmanager

# 앱 로거가 INFO 레벨 출력하도록 기본 설정
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.cache.setup import ensure_cache_collection
from src.common.database import init_db
from src.config import settings

logger = logging.getLogger(__name__)
from src.chat.router import router as chat_router
from src.chatbot.router import router as chatbot_router, admin_router as chatbot_admin_router
from src.admin.router import router as admin_router
from src.admin.data_router import router as admin_data_router
from src.datasource.router import router as datasource_router
from src.common.exception_handlers import (
    embedding_failed_handler,
    input_blocked_handler,
    rate_limit_handler,
    search_failed_handler,
    unhandled_exception_handler,
)
from src.common.middleware import RequestIdMiddleware
from src.safety.exceptions import InputBlockedError, RateLimitExceededError
from src.search.exceptions import EmbeddingFailedError, SearchFailedError


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 DB + 캐시 컬렉션 초기화. 실패해도 앱은 시작."""
    try:
        await init_db()
    except Exception as e:
        logger.warning("init_db 실패 (프로덕션에서는 Alembic 사용): %s", e)
    try:
        await ensure_cache_collection()
        app.state.cache_available = True
    except Exception as e:
        logger.warning(
            "캐시 컬렉션 초기화 실패 — graceful degradation으로 동작: %s", e
        )
        app.state.cache_available = False

    yield


app = FastAPI(
    title="TrueWords RAG Platform",
    version="0.2.0",
    lifespan=lifespan,
)

# 요청 추적 ID 미들웨어
# CORS보다 먼저 추가되어 INNERMOST로 실행됨 (CORS가 OUTERMOST로 runs first)
# CORS preflight 거부에는 request_id가 없지만, 실제 handler 경로(exception handler 포함)에는 정상 동작함
app.add_middleware(RequestIdMiddleware)

# CORS 미들웨어 (admin 프론트엔드 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.admin_frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-Requested-With"],
)

# 예외 핸들러 (중앙 집중 — src/common/exception_handlers.py)
app.add_exception_handler(InputBlockedError, input_blocked_handler)  # type: ignore[arg-type]
app.add_exception_handler(RateLimitExceededError, rate_limit_handler)  # type: ignore[arg-type]
app.add_exception_handler(SearchFailedError, search_failed_handler)  # type: ignore[arg-type]
app.add_exception_handler(EmbeddingFailedError, embedding_failed_handler)  # type: ignore[arg-type]

# Catch-all — 반드시 마지막에 등록 (구체 예외 핸들러가 먼저 매칭되도록)
app.add_exception_handler(Exception, unhandled_exception_handler)  # type: ignore[arg-type]

# 공개 라우터
app.include_router(chat_router)
app.include_router(chatbot_router)

# 관리자 라우터
app.include_router(admin_router)
app.include_router(chatbot_admin_router)
app.include_router(admin_data_router)
app.include_router(datasource_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
