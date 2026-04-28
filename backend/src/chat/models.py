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
    # R1 Phase 3 N7: 파이프라인 버전 태그.
    # default=1 (legacy/backfill 의미), 신규 코드는 항상 명시적 2 주입.
    pipeline_version: int = Field(default=1, index=False)
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
    # volume 은 Qdrant 의 문자열 권 식별자(예: "001권") 를 강제 캐스팅한 정수.
    # R3 PoC: 원본 문자열 보존을 위해 volume_raw 컬럼 추가 (2단계 마이그레이션 1단계).
    volume: int
    volume_raw: str | None = Field(default=None, max_length=64)
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


class MessageReactionKind(str, enum.Enum):
    """P1-A — 답변 즉시 토글 3종.

    AnswerFeedback (자유서술 + 운영자 라벨링용) 과 분리. 사용자는 1-탭으로
    👍 / 👎 / 💾 를 즉시 누른다. ADR-46 §C.3 답변 평가 영역.
    """

    THUMBS_UP = "thumbs_up"
    THUMBS_DOWN = "thumbs_down"
    SAVE = "save"


class MessageReaction(SQLModel, table=True):
    """P1-A — 사용자 즉시 반응 (👍/👎/💾).

    Unique (message_id, user_session_id, kind) — 동일 사용자 동일 메시지에 같은
    반응 중복 저장 방지. 토글 해제 시 row delete.
    """

    __tablename__ = "chat_message_reactions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    message_id: uuid.UUID = Field(foreign_key="session_messages.id", index=True)
    # 비로그인 사용자도 토글 가능 — 클라이언트가 보내는 fingerprint/cookie 기반 id.
    user_session_id: str = Field(index=True, max_length=128)
    kind: MessageReactionKind
    created_at: datetime = Field(default_factory=datetime.utcnow)
