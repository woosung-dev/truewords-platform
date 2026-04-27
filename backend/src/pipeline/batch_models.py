"""Batch 임베딩 작업 DB 모델."""

import enum
import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel, Column
from sqlalchemy import Text


class BatchStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class BatchJob(SQLModel, table=True):
    __tablename__ = "batch_jobs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    batch_id: str = Field(index=True)
    filename: str
    volume_key: str
    source: str = ""
    total_chunks: int = 0
    status: BatchStatus = Field(default=BatchStatus.PENDING, index=True)
    error_message: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    completed_at: datetime | None = None
    # ADR-30 follow-up — 재업로드 정책. 적재 시점에 payload.source union 적용 등에 사용.
    on_duplicate: str = Field(default="merge", max_length=16)
