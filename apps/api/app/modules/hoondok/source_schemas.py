"""관리자는 목차·문단 토큰만 선택하며 내부 청크 주소는 입력하지 않는다."""
import uuid
from pydantic import BaseModel, ConfigDict, Field
from app.modules.hoondok.summary_schemas import SummarySource


class SourceBook(BaseModel):
    id: uuid.UUID
    title: str
    volume: str


class SourceSection(BaseModel):
    id: str
    title: str
    level: int
    start_block_id: str
    end_block_id: str


class SourceSnapshotInfo(BaseModel):
    id: uuid.UUID
    content_right_id: uuid.UUID
    title: str
    edition: str
    fingerprint: str
    sections: list[SourceSection]
    block_count: int


class SourceBlock(BaseModel):
    id: str
    position: int
    label: str
    text: str
    section_id: str | None = None


class SourcePassages(BaseModel):
    snapshot_id: uuid.UUID
    blocks: list[SourceBlock]
    total: int
    next_offset: int | None


class SourceRangeInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    snapshot_id: uuid.UUID
    start_block_id: str = Field(min_length=1, max_length=36)
    end_block_id: str = Field(min_length=1, max_length=36)
    start_offset: int = Field(default=0, ge=0, strict=True)
    end_offset: int | None = Field(default=None, ge=0, strict=True)
    title: str = Field(min_length=1, max_length=200)
    group_title: str = Field(default='', max_length=300)


class SourceRangeUpdate(SourceRangeInput):
    version: int = Field(ge=1)


class SourceRangeResult(SourceRangeInput):
    id: uuid.UUID
    version: int
    content_right_id: uuid.UUID
    first: str
    last: str
    text: str
    source: SummarySource


class SourceRangeSplit(BaseModel):
    version: int = Field(ge=1)
    after_block_id: str = Field(min_length=1, max_length=36)
    after_offset: int | None = Field(default=None, ge=0, strict=True)
    first_title: str = Field(min_length=1, max_length=200)
    second_title: str = Field(min_length=1, max_length=200)


class SourceRangeMerge(BaseModel):
    version: int = Field(ge=1)
    other_id: uuid.UUID
    other_version: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
