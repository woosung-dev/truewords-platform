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
    # Cloud Run idle 후 Cloud SQL/middlebox가 connection을 끊는 케이스 방어.
    # pre_ping: 사용 직전 SELECT 1 으로 liveness 체크.
    # recycle: 1800s 경과 connection은 재사용하지 않고 새로 발급.
    pool_pre_ping=True,
    pool_recycle=1800,
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


# audit 2차 R-5 (2026-05-15, opus 메타 P1 신규 finding): `get_background_session()`
# dead code 제거. backend/src + backend/tests + backend/scripts grep 호출처 0건 —
# `ingestion_service_session_scope` (pipeline/dependencies.py) factory 가 background
# 컨텍스트의 유일한 진입점으로 정착. 함수 보존 시 raw session 패턴이 ad-hoc 사용으로
# 부활할 위험 (leak / 미닫힘) — 명시적 제거.


async def init_db() -> None:
    """테이블 생성 (개발 환경). 프로덕션은 Alembic 마이그레이션 사용."""
    if settings.environment == "production":
        return  # 프로덕션: Alembic으로 관리

    # 모든 모델을 import하여 SQLModel.metadata에 등록
    from src.admin.models import AdminUser, AdminAuditLog  # noqa: F401
    from src.chat.models import (  # noqa: F401
        ResearchSession, SessionMessage, SearchEvent, AnswerCitation, AnswerFeedback,
    )
    from src.chatbot.models import ChatbotConfig  # noqa: F401
    from src.datasource.models import DataSourceCategory  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
