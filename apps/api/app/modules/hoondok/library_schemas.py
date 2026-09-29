"""말씀 서고 3계층·읽기 기록 계약 (API-HD-023~028). 상태값은 DB ENUM 없이 Literal 로 검증한다."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.modules.hoondok.schemas import AuthorityGrade

# 형광펜은 API-HD-053 구절 단위로 옮겼다 — 단락 표시(API-HD-026)는 북마크만 남는다.
MarkKind = Literal["bookmark"]
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
        """북마크는 색을 갖지 않는다(넘어와도 버린다)."""
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
    # 목록 `?excerpt=true` 일 때만 응답에 나온다 — 원문 뷰 display_text 앞 300자, 원문이 막힌 권·조회 실패는 null.
    excerpt: str | None = None


class MarksResponse(BaseModel):
    items: list[MarkItem]


# --- API-HD-053 구절 형광펜 -------------------------------------------------
# 오프셋은 원문 뷰(API-HD-016) 청크 `display_text` 의 글자 위치다(끝은 배타). 한 구절은 여러 단락에
# 걸칠 수 있지만 한 페이지(PAGE_SIZE 청크) 안이어야 한다 — 화면 하나에서만 고를 수 있기 때문이다.

HIGHLIGHT_PAGE_SIZE = 20  # journey_service.PAGE_SIZE 와 같다


class HighlightInput(BaseModel):
    volume: str = Field(min_length=1, max_length=512)
    chunk_id: str = Field(min_length=1, max_length=128)  # 시작 단락 — 원문 링크(`?chunk_id=`)에 쓴다
    start_chunk_index: int = Field(ge=0)
    start_offset: int = Field(ge=0)
    end_chunk_index: int = Field(ge=0)
    end_offset: int = Field(ge=0)
    quote: str = Field(min_length=1, max_length=4000)  # 고른 글 그대로. 목록 표시·재고정(re-anchor)에 쓴다
    color: int = Field(ge=1, le=3)
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def check_range(self) -> "HighlightInput":
        """끝이 시작보다 뒤여야 하고, 두 끝이 같은 페이지에 있어야 한다."""
        if (self.end_chunk_index, self.end_offset) <= (self.start_chunk_index, self.start_offset):
            raise ValueError("구절의 끝이 시작보다 앞에 있어요")
        if self.start_chunk_index // HIGHLIGHT_PAGE_SIZE != self.end_chunk_index // HIGHLIGHT_PAGE_SIZE:
            raise ValueError("한 구간 안의 구절만 칠할 수 있어요")
        return self


class HighlightPatch(BaseModel):
    """보낸 필드만 바꾼다. `note` 에 null·빈 문자열을 보내면 메모를 지운다."""

    color: int | None = Field(default=None, ge=1, le=3)
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def check_color(self) -> "HighlightPatch":
        """형광펜은 색 없이 둘 수 없다 — 색을 보냈다면 null 이 아니어야 한다."""
        if "color" in self.model_fields_set and self.color is None:
            raise ValueError("형광펜은 색을 골라 주세요")
        return self


class HighlightItem(BaseModel):
    id: str
    volume: str
    chunk_id: str
    start_chunk_index: int
    start_offset: int
    end_chunk_index: int
    end_offset: int
    quote: str
    color: int
    note: str | None
    created_at: datetime
    updated_at: datetime
    work_title: str
    label: str


class HighlightsResponse(BaseModel):
    items: list[HighlightItem]


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
