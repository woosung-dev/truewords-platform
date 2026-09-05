"""Ingestion 파이프라인 DI 조립."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.common.database import async_session_factory, get_async_session
from app.modules.pipeline.ingestion_repository import IngestionJobRepository
from app.modules.pipeline.ingestion_service import IngestionJobService


async def get_ingestion_repository(
    session: AsyncSession = Depends(get_async_session),
) -> IngestionJobRepository:
    return IngestionJobRepository(session)


async def get_ingestion_service(
    repo: IngestionJobRepository = Depends(get_ingestion_repository),
) -> IngestionJobService:
    return IngestionJobService(repo)


@asynccontextmanager
async def ingestion_service_session_scope() -> AsyncIterator[IngestionJobService]:
    """Background worker 컨텍스트 (Depends 불가) 용 단일 session service 조립.

    audit P0-5 fix (2026-05-15): admin/data_router 의 `_delete_volume_artifacts` 처럼
    background context 에서 session + repo + service 를 인라인으로 만들던 부분을
    한 factory 로 통일. session 종료 시 자동 close.
    """
    async with async_session_factory() as session:
        yield IngestionJobService(IngestionJobRepository(session))
