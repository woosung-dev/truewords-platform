"""원문 선택용 불변 스냅샷과 운영자가 정의한 편집 구간."""
import uuid
from datetime import datetime
from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import SQLModel, Field
from app.core.common.clock import utcnow


class SourceSnapshot(SQLModel, table=True):
    __tablename__ = 'hoondok_source_snapshots'
    __table_args__ = (UniqueConstraint('content_right_id', 'fingerprint'),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    content_right_id: uuid.UUID = Field(foreign_key='content_rights.id', index=True)
    collection: str = Field(max_length=200)
    fingerprint: str = Field(max_length=64)
    edition: str = Field(max_length=300)
    text: str
    chunks: list[dict] = Field(sa_column=Column(JSON, nullable=False))
    blocks: list[dict] = Field(sa_column=Column(JSON, nullable=False))
    sections: list[dict] = Field(sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=utcnow)


class SourceRange(SQLModel, table=True):
    __tablename__ = 'hoondok_source_ranges'
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    content_right_id: uuid.UUID = Field(foreign_key='content_rights.id', index=True)
    snapshot_id: uuid.UUID = Field(foreign_key='hoondok_source_snapshots.id', index=True)
    version: int = 1
    title: str = Field(max_length=200)
    group_title: str = Field(default='', max_length=300)
    start_block_id: str = Field(max_length=36)
    end_block_id: str = Field(max_length=36)
    start_offset: int = 0
    end_offset: int | None = None
    source: dict = Field(sa_column=Column(JSON, nullable=False))
    archived: bool = False
    updated_at: datetime = Field(default_factory=utcnow)
