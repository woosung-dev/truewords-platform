"""ChatContext — Pipeline Stage 간 데이터 전달 컨텍스트."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from src.chat.schemas import ChatRequest

if TYPE_CHECKING:
    from src.chat.models import ResearchSession, SessionMessage
    from src.chatbot.runtime_config import ChatbotRuntimeConfig
    from src.search.collection_resolver import ResolvedCollections
    from src.search.hybrid import SearchResult


@dataclass
class ChatContext:
    """Pipeline 전 Stage 가 공유하는 mutable 컨텍스트.

    각 Stage 가 자기 담당 필드를 채우고 다음 Stage 에 넘긴다.
    """

    request: ChatRequest

    # Phase 1 (InputValidation + Session)
    session: ResearchSession | None = None
    user_message: SessionMessage | None = None

    # Phase 2 (Embedding ~ Generation)
    query_embedding: list[float] | None = None
    runtime_config: ChatbotRuntimeConfig | None = None
    resolved_collections: ResolvedCollections | None = None
    search_query: str | None = None
    rewritten_query: str | None = None
    results: list[SearchResult] = field(default_factory=list)
    answer: str | None = None
    assistant_message: SessionMessage | None = None

    # 메타데이터
    search_latency_ms: int = 0
    rerank_latency_ms: int = 0
    reranked: bool = False
    fallback_type: str = "none"
