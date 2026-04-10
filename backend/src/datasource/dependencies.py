"""데이터 소스 카테고리 DI 조립."""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.database import get_async_session
from src.config import settings
from src.datasource.qdrant_service import DataSourceQdrantService
from src.datasource.repository import DataSourceCategoryRepository
from src.datasource.service import DataSourceCategoryService
from src.qdrant_client import get_async_client, get_client


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
        async_client=get_async_client(),
        sync_client=get_client(),
        collection_name=settings.collection_name,
    )
