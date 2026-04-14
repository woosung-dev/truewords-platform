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


class VolumeTagRequest(BaseModel):
    """문서에 카테고리 태그 추가/제거 요청."""
    volume: str                # 대상 문서 이름
    source: str                # 추가 또는 제거할 카테고리 key


class VolumeTagResponse(BaseModel):
    """태그 변경 결과."""
    volume: str
    updated_sources: list[str]  # 변경 후 전체 카테고리 목록
    updated_chunks: int         # 변경된 청크 수


class VolumeInfo(BaseModel):
    """전체 volume 목록 조회 응답 — Transfer UI용."""
    volume: str = Field(..., description="문서(volume) 이름")
    sources: list[str] = Field(default_factory=list, description="속한 카테고리 key 배열")
    chunk_count: int = Field(..., description="청크 수")


class VolumeTagsBulkRequest(BaseModel):
    """다중 volume에 동일 source 태그를 추가/제거 요청."""
    volumes: list[str] = Field(..., min_length=1, description="대상 volume 리스트")
    source: str = Field(..., min_length=1, description="추가 또는 제거할 카테고리 key")


class VolumeTagsBulkResponse(BaseModel):
    """bulk 태그 변경 결과."""
    updated_volumes: list[str] = Field(default_factory=list, description="실제로 변경된 volume 리스트")
    skipped_volumes: list[dict] = Field(
        default_factory=list,
        description="스킵된 volume 리스트. 각 항목: {volume, reason}",
    )
    total_chunks_modified: int = Field(0, description="변경된 청크 총 수")
