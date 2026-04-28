"""ChatContext — Pipeline Stage 간 데이터 전달 컨텍스트."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from src.chat.pipeline.state import PipelineState
from src.chat.schemas import ChatRequest
from src.search.intent_classifier import Intent

if TYPE_CHECKING:
    from src.cache.schemas import CacheHit
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
    # Phase D (액션 1) — 사용자 질문 의도. RuntimeConfig 다음 IntentClassifierStage 가 채움.
    # Rerank/Generation 은 이 값으로 K 분기. None 이면 IntentClassifier 미실행 (legacy 경로).
    intent: Intent | None = None
    results: list[SearchResult] = field(default_factory=list)
    answer: str | None = None
    assistant_message: SessionMessage | None = None

    # P0-E — 최종 결정된 답변 모드 (standard/theological/pastoral/beginner/kids).
    # GenerationStage 가 IntentClassifier 결과 + req.answer_mode 우선순위로 결정.
    resolved_answer_mode: str | None = None

    # B5 — 사용자가 명시한 페르소나가 위기 신호로 인해 pastoral 로 강제 override 됐는지.
    # True 면 응답 클라이언트가 "위기 신호로 감지되어 상담 모드로 전환됐어요" 노티 노출.
    persona_overridden: bool = False

    # P0-A — 후속 질문 추천 3개. SuggestedFollowupsStage 가 채움.
    suggested_followups: list[str] | None = None
    # P1-J — 기도문/결의문 마무리 텍스트. ClosingTemplateStage 가 채움.
    closing: str | None = None

    # Phase 3 (Cache check — early return)
    cache_hit: bool = False
    cache_response: CacheHit | None = None  # apply_safety_layer 적용된 답변 보유

    # 메타데이터
    search_latency_ms: int = 0
    rerank_latency_ms: int = 0
    reranked: bool = False
    fallback_type: str = "none"

    # R1 Phase 3 N3: FSM 상태 (Stage 가 진입/완료 시 갱신, logger.warning 검증)
    pipeline_state: PipelineState = PipelineState.INIT
