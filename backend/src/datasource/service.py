"""데이터 소스 카테고리 Service."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from src.datasource.models import DataSourceCategory
from src.datasource.repository import DataSourceCategoryRepository
from src.datasource.schemas import DataSourceCategoryCreate, DataSourceCategoryUpdate


class DataSourceCategoryService:
    def __init__(self, repo: DataSourceCategoryRepository) -> None:
        self.repo = repo

    async def list_all(self) -> list[DataSourceCategory]:
        return await self.repo.list_all_ordered()

    async def list_active(self) -> list[DataSourceCategory]:
        return await self.repo.list_active_ordered()

    async def list_searchable(self) -> list[DataSourceCategory]:
        return await self.repo.list_searchable()

    async def get_by_key(self, key: str) -> DataSourceCategory | None:
        return await self.repo.get_by_key(key)

    async def create(self, data: DataSourceCategoryCreate) -> DataSourceCategory:
        category = DataSourceCategory(**data.model_dump())
        try:
            category = await self.repo.create(category)
            await self.repo.commit()
        except IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"이미 존재하는 key입니다: {data.key}",
            )
        return category

    async def update(
        self, category_id: uuid.UUID, data: DataSourceCategoryUpdate
    ) -> DataSourceCategory:
        category = await self.repo.get_by_id(category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="카테고리를 찾을 수 없습니다",
            )
        updates = data.model_dump(exclude_unset=True)
        category = await self.repo.update(category, updates)
        await self.repo.commit()
        return category

    async def delete(self, category_id: uuid.UUID) -> None:
        """soft delete (is_active=False)."""
        category = await self.repo.get_by_id(category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="카테고리를 찾을 수 없습니다",
            )
        await self.repo.update(category, {"is_active": False})
        await self.repo.commit()
