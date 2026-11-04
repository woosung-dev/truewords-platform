"""요약 단위·작업본·공개 스냅샷 및 비공개 미디어."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import JSON, Column, UniqueConstraint, ForeignKey, Uuid
from sqlmodel import SQLModel, Field


def now():
    return datetime.now(timezone.utc)


class SummaryUnit(SQLModel, table=True):
    __tablename__ = "ai_summary_units"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    content_right_id: uuid.UUID = Field(foreign_key="content_rights.id", index=True)
    slug: str = Field(max_length=100, unique=True)
    version: int = 1
    review_status: str = Field(default="draft", max_length=20)
    draft: dict = Field(sa_column=Column(JSON, nullable=False))
    published_revision_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid,
            ForeignKey(
                "ai_summary_revisions.id",
                name="fk_summary_published_revision",
                use_alter=True,
            ),
            nullable=True,
        ),
    )
    updated_at: datetime = Field(default_factory=now)


class SummaryRevision(SQLModel, table=True):
    __tablename__ = "ai_summary_revisions"
    __table_args__ = (UniqueConstraint("unit_id", "version"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    unit_id: uuid.UUID = Field(foreign_key="ai_summary_units.id", index=True)
    version: int
    payload: dict = Field(sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=now)


class SummaryAsset(SQLModel, table=True):
    __tablename__ = "ai_summary_assets"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    unit_id: uuid.UUID = Field(foreign_key="ai_summary_units.id", index=True)
    mime_type: str = Field(max_length=40)
    filename: str = Field(max_length=100)
    created_at: datetime = Field(default_factory=now)
