"""Alembic 마이그레이션 환경 설정."""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel

from src.config import settings

# 모든 모델을 import하여 SQLModel.metadata에 등록
from src.admin.models import AdminUser, AdminAuditLog  # noqa: F401
from src.chat.models import (  # noqa: F401
    ResearchSession,
    SessionMessage,
    SearchEvent,
    AnswerCitation,
    AnswerFeedback,
)
from src.chatbot.models import ChatbotConfig  # noqa: F401
from src.datasource.models import DataSourceCategory  # noqa: F401
from src.pipeline.batch_models import BatchJob  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """오프라인 마이그레이션 (SQL 스크립트 생성용)."""
    context.configure(
        url=settings.database_url.get_secret_value(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """온라인 마이그레이션 (DB 직접 연결)."""
    engine = create_async_engine(settings.database_url.get_secret_value())
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
