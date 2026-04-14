"""즉시 모드 적재 작업 DB 모델."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Text
from sqlmodel import Column, Field, SQLModel


class IngestionStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class IngestionJob(SQLModel, table=True):
    __tablename__ = "ingestion_jobs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    filename: str
    # NFC 정규화된 volume 키. 재업로드 시 UPSERT 기준.
    volume_key: str = Field(unique=True, index=True)
    source: str = ""
    total_chunks: int = 0
    processed_chunks: int = 0
    status: IngestionStatus = Field(default=IngestionStatus.PENDING, index=True)
    error_message: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
