"""데이터 소스 카테고리 Repository."""

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.datasource.models import DataSourceCategory


class DataSourceCategoryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_all_ordered(self) -> list[DataSourceCategory]:
        """전체 목록 (sort_order ASC)."""
        result = await self.session.execute(
            select(DataSourceCategory).order_by(DataSourceCategory.sort_order)
        )
        return list(result.scalars().all())

    async def list_active_ordered(self) -> list[DataSourceCategory]:
        """활성 카테고리만 (sort_order ASC)."""
        result = await self.session.execute(
            select(DataSourceCategory)
            .where(DataSourceCategory.is_active == True)
            .order_by(DataSourceCategory.sort_order)
        )
        return list(result.scalars().all())

    async def list_searchable(self) -> list[DataSourceCategory]:
        """검색 가능 카테고리만 (is_active=True AND is_searchable=True)."""
        result = await self.session.execute(
            select(DataSourceCategory)
            .where(
                DataSourceCategory.is_active == True,
                DataSourceCategory.is_searchable == True,
            )
            .order_by(DataSourceCategory.sort_order)
        )
        return list(result.scalars().all())

    async def get_by_id(self, category_id: uuid.UUID) -> DataSourceCategory | None:
        result = await self.session.execute(
            select(DataSourceCategory).where(DataSourceCategory.id == category_id)
        )
        return result.scalar_one_or_none()

    async def get_by_key(self, key: str) -> DataSourceCategory | None:
        result = await self.session.execute(
            select(DataSourceCategory).where(DataSourceCategory.key == key)
        )
        return result.scalar_one_or_none()

    async def create(self, category: DataSourceCategory) -> DataSourceCategory:
        self.session.add(category)
        await self.session.flush()
        return category

    async def update(
        self, category: DataSourceCategory, updates: dict
    ) -> DataSourceCategory:
        for field, value in updates.items():
            if value is not None:
                setattr(category, field, value)
        category.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await self.session.flush()
        return category

    async def commit(self) -> None:
        await self.session.commit()
