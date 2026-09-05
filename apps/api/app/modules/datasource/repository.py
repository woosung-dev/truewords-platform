"""데이터 소스 카테고리 Repository."""

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.datasource.models import DataSourceCategory


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
        """활성 카테고리만 (sort_order ASC).

        audit 2차 P-4 (2026-05-15): SQLAlchemy 2.0 권장 — ``col == True`` 대신
        ``col.is_(True)``. mypy/lint warning 회피 + DB dialect 호환.
        """
        result = await self.session.execute(
            select(DataSourceCategory)
            .where(DataSourceCategory.is_active.is_(True))
            .order_by(DataSourceCategory.sort_order)
        )
        return list(result.scalars().all())

    async def list_searchable(self) -> list[DataSourceCategory]:
        """검색 가능 카테고리만 (is_active=True AND is_searchable=True)."""
        result = await self.session.execute(
            select(DataSourceCategory)
            .where(
                DataSourceCategory.is_active.is_(True),
                DataSourceCategory.is_searchable.is_(True),
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
        """카테고리 부분 갱신.

        audit 2차 P-3 (2026-05-15, Agent B P1 7/10): 기존 ``if value is not None``
        필터는 호출자가 명시적 ``None`` 으로 reset 의도해도 무시 → semantics drift.
        Service 가 ``model_dump(exclude_unset=True)`` 로 호출자가 보낸 필드만 추려
        전달하면 충분. 본 fix 는 ``None`` 허용 — 명시 null 갱신 가능.
        """
        for field, value in updates.items():
            setattr(category, field, value)
        category.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await self.session.flush()
        return category

    async def commit(self) -> None:
        await self.session.commit()
