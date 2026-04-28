"""채팅 도메인 DB 모델: 세션, 메시지, 검색 이벤트, 인용, 피드백."""

import enum
import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel, Column
from sqlalchemy import JSON, Text
from sqlalchemy import UniqueConstraint


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


class ReviewLabel(str, enum.Enum):
    """P1-K — 운영자 검수 라벨.

    AnswerFeedback (사용자 자유서술/혼합) 와 별도. 운영자가 답변을 검수해
    이단/오류 여부를 라벨링하기 위한 enum 이며, 부적합 라벨 (theological_error,
    citation_error, tone_error) 은 추후 negative few-shot 학습 데이터로 활용된다.
    """

    APPROVED = "approved"
    THEOLOGICAL_ERROR = "theological_error"
    CITATION_ERROR = "citation_error"
    TONE_ERROR = "tone_error"
    OFF_DOMAIN = "off_domain"


class AnswerReview(SQLModel, table=True):
    """P1-K — 운영자 검수 사이클 + 이단/오류 학습 데이터 테이블.

    - reviewer_user_id: admin_users.id 를 가리키지만, 향후 외부 SSO 도입 시
      admin_users 행이 없는 reviewer 도 허용하도록 명시 FK 는 두지 않는다.
    - 한 메시지에 여러 reviewer 의 라벨을 누적할 수 있다 (의견 차이 추적).
    """

    __tablename__ = "answer_reviews"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    message_id: uuid.UUID = Field(foreign_key="session_messages.id", index=True)
    reviewer_user_id: uuid.UUID = Field(index=True)
    label: ReviewLabel
    notes: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class ChatMessageNote(SQLModel, table=True):
    """P1-H — 인용 카드 단위 사용자 노트 (3-tab 의 노트 탭 영속화).

    답변 메시지의 각 인용 카드(chunk_id 단위)에 대해 사용자가 자유롭게 메모를
    남긴다. ``MessageReaction`` 과 동일하게 익명 ``user_session_id`` (HttpOnly
    cookie 발급) 로 사용자를 식별한다.

    UNIQUE (message_id, chunk_id, user_session_id) — 한 사용자가 한 인용 카드에
    하나의 노트만 가진다. 갱신은 in-place UPDATE.
    """

    __tablename__ = "chat_message_notes"
    __table_args__ = (
        UniqueConstraint(
            "message_id",
            "chunk_id",
            "user_session_id",
            name="uq_message_note_user_chunk",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    message_id: uuid.UUID = Field(foreign_key="session_messages.id", index=True)
    # Qdrant point id (chunk 식별자). 인용 카드 단위 노트 키.
    chunk_id: str = Field(max_length=128)
    # MessageReaction 과 동일한 익명 cookie 세션 id.
    user_session_id: str = Field(index=True, max_length=128)
    body: str = Field(sa_column=Column(Text))
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        index=True,
    )
