"""권리·서고·정성 말씀 계약. 권리 상태는 DB ENUM 없이 검증한다."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.hoondok.library_schemas import LibraryWork, WordSection
from app.modules.hoondok.schemas import AuthorityGrade, DailyReadingPublic, TodayStatus


class ContentRightInput(BaseModel):
    volume: str = Field(min_length=1, max_length=512)
    status: Literal["pending", "allowed", "withdrawn"] = "pending"
    scope_search: bool = False
    scope_full_text: bool = False
    scope_jeongseong: bool = False
    work_title: str = Field(min_length=1, max_length=200)
    source_keys: list[str] = Field(default_factory=list, max_length=32)
    book_series: str | None = Field(default=None, max_length=200)
    authority_grade: AuthorityGrade = "R"
    note: str = Field(default="", max_length=2000)

    @field_validator("work_title")
    @classmethod
    def nonblank_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("표시 제목이 필요합니다")
        return value.strip()

    @field_validator("volume")
    @classmethod
    def nonblank_volume(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("저작물 식별자가 필요합니다")
        return value


class ContentRightResponse(ContentRightInput):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    # 시드 스크립트가 채우는 Qdrant 청크 수. 입력에는 없어 admin 저장이 덮어쓰지 않는다.
    chunk_count: int | None = None
    created_at: datetime
    updated_at: datetime


class LibraryItem(BaseModel):
    volume: str
    work_title: str
    scope_search: bool
    scope_full_text: bool
    source_keys: list[str]
    book_series: str | None
    authority_grade: AuthorityGrade


class LibraryResponse(BaseModel):
    items: list[LibraryItem]
    # API-HD-014 확장 — 저작물(시리즈) 집계. 기존 소비자를 위해 기본값을 둔다.
    works: list[LibraryWork] = Field(default_factory=list)


class WordChunk(BaseModel):
    chunk_id: str
    chunk_index: int
    text: str


class WordSearchResult(WordChunk):
    work_title: str
    authority_grade: AuthorityGrade
    volume: str
    score: float
    can_read_full_text: bool


class WordSearchResponse(BaseModel):
    results: list[WordSearchResult]


class WordsResponse(BaseModel):
    authority_grade: AuthorityGrade
    volume: str
    work_title: str
    page: int
    page_size: int
    total_chunks: int
    total_pages: int
    chunks: list[WordChunk]
    body: str
    # API-HD-016 확장 — 반환 페이지 첫 청크를 품는 장. 목차가 없으면 None.
    section: WordSection | None = None


class JeongseongTodayResponse(BaseModel):
    date: date
    status: TodayStatus
    reason: (
        Literal["no_period", "upcoming", "no_candidates", "rights_withdrawn"] | None
    ) = None
    period_id: uuid.UUID | None = None
    reading: DailyReadingPublic | None = None


class ClientErrorInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["sw_register", "install_prompt", "unhandled", "api_5xx", "push_subscribe"]
    path: str = Field(max_length=2048)
