"""ChatbotConfig DB 모델."""

import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel, Column
from sqlalchemy import JSON


def _utcnow() -> datetime:
    """naive UTC datetime (asyncpg 호환)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ChatbotConfig(SQLModel, table=True):
    __tablename__ = "chatbot_configs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    chatbot_id: str = Field(unique=True, index=True)
    display_name: str
    description: str = ""
    system_prompt: str = Field(default="")
    persona_name: str = Field(default="")
    # JSONB: {"tiers": [...], "rerank_enabled": false, "dictionary_enabled": false}
    search_tiers: dict = Field(default_factory=dict, sa_column=Column(JSON))
    # [DEPRECATED] Phase 2 청킹/Contextual Retrieval A/B 비교용 토글.
    # Phase 2.4(v5 Recursive 88권 운영 채택) 이후 미사용. 다음 배포에서 Alembic drop 예정.
    collection_main: str = Field(default="malssum_poc")
    is_active: bool = Field(default=True)
    organization_id: uuid.UUID | None = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
