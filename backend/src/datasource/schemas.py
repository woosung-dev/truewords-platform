"""데이터 소스 카테고리 Pydantic 스키마."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class DataSourceCategoryResponse(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    description: str
    color: str
    sort_order: int
    is_active: bool
    is_searchable: bool
    created_at: datetime
    updated_at: datetime


class DataSourceCategoryCreate(BaseModel):
    key: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_]+$")
    name: str = Field(min_length=1)
    description: str = ""
    color: str = ""
    sort_order: int = 0
    is_active: bool = True
    is_searchable: bool = True


class DataSourceCategoryUpdate(BaseModel):
    # key는 수정 불가 — 스키마에서 제외
    name: str | None = None
    description: str | None = None
    color: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    is_searchable: bool | None = None


class CategoryDocumentStats(BaseModel):
    """카테고리별 Qdrant 문서 통계."""
    source: str              # 카테고리 key (e.g. "A")
    total_chunks: int        # Qdrant 포인트 총 수
    volumes: list[str]       # 고유 volume 목록 (알파벳순 정렬)
    volume_count: int        # len(volumes) — 프론트 편의용
