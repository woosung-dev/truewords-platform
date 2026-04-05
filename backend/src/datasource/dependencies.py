"""데이터 소스 카테고리 DI 조립."""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.database import get_async_session
from src.datasource.repository import DataSourceCategoryRepository
from src.datasource.service import DataSourceCategoryService


async def get_datasource_repository(
    session: AsyncSession = Depends(get_async_session),
) -> DataSourceCategoryRepository:
    return DataSourceCategoryRepository(session)


async def get_datasource_service(
    repo: DataSourceCategoryRepository = Depends(get_datasource_repository),
) -> DataSourceCategoryService:
    return DataSourceCategoryService(repo)
