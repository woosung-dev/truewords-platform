"""ChatbotConfig DB 모델."""

import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel, Column
from sqlalchemy import JSON


class ChatbotConfig(SQLModel, table=True):
    __tablename__ = "chatbot_configs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    chatbot_id: str = Field(unique=True, index=True)
    display_name: str
    description: str = ""
    system_prompt_version: str | None = None
    # JSONB: {"tiers": [{"sources": ["A"], "min_results": 3, "score_threshold": 0.75}]}
    search_tiers: dict = Field(default_factory=dict, sa_column=Column(JSON))
    is_active: bool = Field(default=True)
    organization_id: uuid.UUID | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
