"""말씀 서고 3계층·읽기 기록 계약 (API-HD-023~028). 상태값은 DB ENUM 없이 Literal 로 검증한다."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.modules.hoondok.schemas import AuthorityGrade

MarkKind = Literal["bookmark", "highlight"]
RightStatus = Literal["pending", "allowed", "withdrawn"]


# --- API-HD-014 확장: 저작물 집계 ------------------------------------------


class LibraryWork(BaseModel):
    """`book_series` 로 묶은 저작물 1건. 허용 권이 1건 이상인 시리즈만 목록에 오른다."""

    series: str
    title: str
    volume_count: int  # 원장에 등록된 전체 권 수(status 무관)
    allowed_count: int  # allowed 이면서 검색 또는 원문이 열린 권 수
    authority_grade: AuthorityGrade  # 허용 권의 최빈 등급(동률이면 R)
    scope_search: bool
    scope_full_text: bool


# --- API-HD-023 시리즈 상세 -------------------------------------------------


class SeriesVolume(BaseModel):
    volume: str
    label: str
    total_chunks: int | None  # content_rights.chunk_count — 시드 전이면 None
    section_count: int
    scope_full_text: bool


class SeriesDetailResponse(BaseModel):
    series: str
    title: str
    authority_grade: AuthorityGrade
    volumes: list[SeriesVolume]


# --- API-HD-024 장 목차 -----------------------------------------------------


class SectionItem(BaseModel):
    position: int
    level: int
    title: str
    start_chunk_index: int
    end_chunk_index: int
    spoken_on: str | None
    place: str | None


class SectionsResponse(BaseModel):
    volume: str
    sections: list[SectionItem]


class WordSection(BaseModel):
    """API-HD-016 응답에 동봉하는 현재 구간 요약."""

    position: int
    level: int
    title: str


# --- API-HD-025 이어 읽기 ---------------------------------------------------


class ReadingPositionInput(BaseModel):
    chunk_index: int = Field(ge=0)


class ReadingPositionItem(BaseModel):
    volume: str
    chunk_index: int
    updated_at: datetime
    work_title: str
    series: str | None
    label: str


class ReadingPositionsResponse(BaseModel):
    items: list[ReadingPositionItem]


# --- API-HD-026 단락 표시 ---------------------------------------------------


class MarkInput(BaseModel):
    volume: str = Field(min_length=1, max_length=512)
    chunk_index: int = Field(ge=0)
    kind: MarkKind
    color: int | None = Field(default=None, ge=1, le=3)
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def check_color(self) -> "MarkInput":
        """형광펜은 색이 있어야 하고, 북마크는 색을 갖지 않는다(넘어와도 버린다)."""
        if self.kind == "highlight" and self.color is None:
            raise ValueError("형광펜은 색을 골라 주세요")
        if self.kind == "bookmark":
            self.color = None
        return self


class MarkItem(BaseModel):
    chunk_id: str
    chunk_index: int
    volume: str
    kind: MarkKind
    color: int | None
    note: str | None
    updated_at: datetime
    work_title: str
    label: str


class MarksResponse(BaseModel):
    items: list[MarkItem]


# --- API-HD-027·028 admin ---------------------------------------------------


class BulkRightsInput(BaseModel):
    book_series: str = Field(min_length=1, max_length=200)
    status: RightStatus
    scope_search: bool = False
    scope_full_text: bool = False
    scope_jeongseong: bool = False
    authority_grade: AuthorityGrade | None = None  # 미지정이면 기존 등급을 보존한다


class BulkRightsResponse(BaseModel):
    book_series: str
    updated: int


class SeriesSummaryItem(BaseModel):
    series: str
    title: str
    registered: int
    allowed: int
    pending: int
    withdrawn: int
    chunk_count: int | None


class SeriesSummaryResponse(BaseModel):
    items: list[SeriesSummaryItem]
