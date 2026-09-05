"""데이터 소스 카테고리 DI 조립."""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.common.database import get_async_session
from app.core.config import settings
from app.modules.datasource.qdrant_service import DataSourceQdrantService
from app.modules.datasource.repository import DataSourceCategoryRepository
from app.modules.datasource.service import DataSourceCategoryService
from app.modules.qdrant import get_raw_client  # audit 2차 B-6 — src.qdrant_client deprecated shim 이관


async def get_datasource_repository(
    session: AsyncSession = Depends(get_async_session),
) -> DataSourceCategoryRepository:
    return DataSourceCategoryRepository(session)


async def get_datasource_service(
    repo: DataSourceCategoryRepository = Depends(get_datasource_repository),
) -> DataSourceCategoryService:
    return DataSourceCategoryService(repo)


async def get_qdrant_service() -> DataSourceQdrantService:
    return DataSourceQdrantService(
        client=get_raw_client(),
        collection_name=settings.collection_name,
    )
