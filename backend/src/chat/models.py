"""채팅 도메인 DB 모델: 세션, 메시지, 검색 이벤트, 인용, 피드백."""

import enum
import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel, Column
from sqlalchemy import JSON, Text


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"


class FeedbackType(str, enum.Enum):
    HELPFUL = "helpful"
    INACCURATE = "inaccurate"
    MISSING_CITATION = "missing_citation"
    IRRELEVANT = "irrelevant"
    OTHER = "other"


class ResearchSession(SQLModel, table=True):
    __tablename__ = "research_sessions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID | None = None  # 미래 확장용
    chatbot_config_id: uuid.UUID | None = Field(default=None, foreign_key="chatbot_configs.id", index=True)
    client_fingerprint: str | None = None
    organization_id: uuid.UUID | None = None
    started_at: datetime = Field(
        default_factory=datetime.utcnow, index=True
    )
    ended_at: datetime | None = None


class SessionMessage(SQLModel, table=True):
    __tablename__ = "session_messages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    session_id: uuid.UUID = Field(foreign_key="research_sessions.id", index=True)
    role: MessageRole
    content: str = Field(sa_column=Column(Text))
    token_count: int | None = None
    created_at: datetime = Field(
        default_factory=datetime.utcnow, index=True
    )


class SearchEvent(SQLModel, table=True):
    __tablename__ = "search_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    message_id: uuid.UUID = Field(foreign_key="session_messages.id", index=True)
    query_text: str = Field(sa_column=Column(Text))
    rewritten_query: str | None = Field(default=None, sa_column=Column(Text))
    applied_filters: dict = Field(default_factory=dict, sa_column=Column(JSON))
    search_tier: int = 0
    total_results: int = 0
    latency_ms: int = 0
    qdrant_request_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnswerCitation(SQLModel, table=True):
    __tablename__ = "answer_citations"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    message_id: uuid.UUID = Field(foreign_key="session_messages.id", index=True)
    source: str  # A, B, C
    volume: int
    chapter: str | None = None
    text_snippet: str = Field(sa_column=Column(Text))
    relevance_score: float = 0.0
    rank_position: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnswerFeedback(SQLModel, table=True):
    __tablename__ = "answer_feedback"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    message_id: uuid.UUID = Field(foreign_key="session_messages.id", index=True)
    feedback_type: FeedbackType
    comment: str | None = None
    user_id: uuid.UUID | None = None  # 미래 확장용
    created_at: datetime = Field(default_factory=datetime.utcnow)
