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
    # JSONB: {"tiers": [...], "rerank_enabled": false, "dictionary_enabled": false, "multiturn_enabled": true}
    search_tiers: dict = Field(default_factory=dict, sa_column=Column(JSON))
    is_active: bool = Field(default=True)
    # 봇별 SSE 스트리밍 응답 활성화 여부. default true.
    # admin 에서 false 로 설정하면 chat 화면이 비스트림(/chat) 단일 응답으로 분기.
    streaming_enabled: bool = Field(default=True)
    # 입력 화면 추천 질문 칩 (봇별 동적). cron job 이 30 일 질문 로그 + RAG sample 로
    # 매일 03:30 KST 갱신. 비어있으면 chat 페이지가 FALLBACK_PROMPTS 4 개로 fallback.
    suggested_questions: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    suggested_at: datetime | None = None
    organization_id: uuid.UUID | None = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
