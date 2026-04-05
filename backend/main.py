from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.cache.setup import ensure_cache_collection
from src.common.database import init_db
from src.config import settings
from src.chat.router import router as chat_router
from src.chatbot.router import router as chatbot_router, admin_router as chatbot_admin_router
from src.admin.router import router as admin_router
from src.admin.data_router import router as admin_data_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 DB + 캐시 컬렉션 초기화."""
    await init_db()
    await ensure_cache_collection()
    yield


app = FastAPI(
    title="TrueWords RAG Platform",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS 미들웨어 (admin 프론트엔드 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.admin_frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-Requested-With"],
)

# 공개 라우터
app.include_router(chat_router)
app.include_router(chatbot_router)

# 관리자 라우터
app.include_router(admin_router)
app.include_router(chatbot_admin_router)
app.include_router(admin_data_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
