"""데이터 소스 카테고리 DB 모델."""

import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    """naive UTC datetime (asyncpg 호환)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class DataSourceCategory(SQLModel, table=True):
    __tablename__ = "data_source_categories"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    # Qdrant payload 'source' 필드와 1:1 매핑. 생성 후 변경 불가.
    key: str = Field(unique=True, index=True, max_length=20)
    name: str  # "말씀선집", "어머니말씀" 등
    description: str = ""
    color: str = ""  # 프론트엔드 Tailwind 색상 키워드 (indigo, violet 등)
    sort_order: int = Field(default=0)
    is_active: bool = Field(default=True)
    # False면 검색 티어 에디터에서 제외 (ex: D 용어사전)
    is_searchable: bool = Field(default=True)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
