"""PostgreSQL AsyncSession 팩토리. 요청 스코프 + 백그라운드 태스크용."""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from src.config import settings

engine = create_async_engine(
    settings.database_url.get_secret_value(),
    echo=False,
    pool_size=5,
    max_overflow=10,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """요청 스코프 세션. Depends()로 주입."""
    async with async_session_factory() as session:
        yield session


async def get_background_session() -> AsyncSession:
    """BackgroundTasks용 세션. 함수 내에서 직접 생성/종료."""
    return async_session_factory()


async def init_db() -> None:
    """테이블 생성 (개발 환경). 프로덕션은 Alembic 사용."""
    # 모든 모델을 import하여 SQLModel.metadata에 등록
    from src.admin.models import AdminUser, AdminAuditLog  # noqa: F401
    from src.chat.models import (  # noqa: F401
        ResearchSession, SessionMessage, SearchEvent, AnswerCitation, AnswerFeedback,
    )
    from src.chatbot.models import ChatbotConfig  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
