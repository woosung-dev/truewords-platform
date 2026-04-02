from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.common.database import init_db
from src.chat.router import router as chat_router
from src.chatbot.router import router as chatbot_router, admin_router as chatbot_admin_router
from src.admin.router import router as admin_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 DB 초기화."""
    await init_db()
    yield


app = FastAPI(
    title="TrueWords RAG Platform",
    version="0.2.0",
    lifespan=lifespan,
)

# 공개 라우터
app.include_router(chat_router)
app.include_router(chatbot_router)

# 관리자 라우터
app.include_router(admin_router)
app.include_router(chatbot_admin_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
