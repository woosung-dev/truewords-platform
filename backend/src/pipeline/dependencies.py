"""Ingestion 파이프라인 DI 조립."""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.database import get_async_session
from src.pipeline.ingestion_repository import IngestionJobRepository
from src.pipeline.ingestion_service import IngestionJobService


async def get_ingestion_repository(
    session: AsyncSession = Depends(get_async_session),
) -> IngestionJobRepository:
    return IngestionJobRepository(session)


async def get_ingestion_service(
    repo: IngestionJobRepository = Depends(get_ingestion_repository),
) -> IngestionJobService:
    return IngestionJobService(repo)
