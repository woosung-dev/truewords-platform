"""ChatContext — Pipeline Stage 간 데이터 전달 컨텍스트."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from app.modules.chat.pipeline.state import PipelineState
from app.modules.chat.schemas import ChatRequest
from app.modules.search.intent_classifier import Intent

if TYPE_CHECKING:
    from app.modules.cache.schemas import CacheHit
    from app.modules.chat.models import ResearchSession, SessionMessage
    from app.modules.chatbot.runtime_config import ChatbotRuntimeConfig
    from app.modules.search.collection_resolver import ResolvedCollections
    from app.modules.search.hybrid import SearchResult


@dataclass
class ChatContext:
    """Pipeline 전 Stage 가 공유하는 mutable 컨텍스트.

    각 Stage 가 자기 담당 필드를 채우고 다음 Stage 에 넘긴다.
    """

    request: ChatRequest

    # 로그인 사용자 id — 익명이면 None. SessionStage 가 신규 ResearchSession.user_id 로 귀속.
    user_id: uuid.UUID | None = None

    # Phase 1 (InputValidation + Session)
    session: ResearchSession | None = None
    user_message: SessionMessage | None = None
    # 멀티턴 — SessionStage 가 현재 user_message 저장 **전** 시점의 직전 대화
    # 이력을 채운다 (created_at 오름차순). 비어있지 않으면 후속 턴 — CacheCheck /
    # Persist 의 캐시 스킵 판정과 Generation 의 이력 주입 기준이 된다.
    history: list[SessionMessage] = field(default_factory=list)

    # Phase 2 (Embedding ~ Generation)
    query_embedding: list[float] | None = None
    # 원본 질문 임베딩 — QueryRewriteStage 가 query_embedding 을 덮어쓴 이후에도
    # semantic cache 저장/검색은 원본 기준으로 일치시켜야 hit 가 보장된다.
    original_query_embedding: list[float] | None = None
    runtime_config: ChatbotRuntimeConfig | None = None
    resolved_collections: ResolvedCollections | None = None
    search_query: str | None = None
    rewritten_query: str | None = None
    # Phase D (액션 1) — 사용자 질문 의도. RuntimeConfig 다음 IntentClassifierStage 가 채움.
    # Rerank/Generation 은 이 값으로 K 분기. None 이면 IntentClassifier 미실행 (legacy 경로).
    intent: Intent | None = None
    results: list[SearchResult] = field(default_factory=list)
    # Phase 3 (메타데이터 필터): 검색 전 단계에서 질문에서 추출한 권/날짜/페이지.
    # SearchStage 가 채우고 cascading/weighted_search 의 hybrid_search 로 전달된다.
    # 빈 dict 면 metadata filter 적용 안 함 (= v5 baseline).
    query_metadata: dict[str, int] = field(default_factory=dict)
    answer: str | None = None
    assistant_message: SessionMessage | None = None

    # P0-E — 최종 결정된 답변 모드 (standard/theological/pastoral/beginner/kids).
    # GenerationStage 가 IntentClassifier 결과 + req.answer_mode 우선순위로 결정.
    resolved_answer_mode: str | None = None

    # B5 — 사용자가 명시한 페르소나가 위기 신호로 인해 pastoral 로 강제 override 됐는지.
    # True 면 응답 클라이언트가 "위기 신호로 감지되어 상담 모드로 전환됐어요" 노티 노출.
    persona_overridden: bool = False

    # M1 — 측정 인프라. PersistStage 가 session_messages row 생성 시 영속화.
    # B5/C3 효과 분석 baseline. crisis_trigger 는 매칭된 키워드 텍스트 또는
    # "intent:crisis" / None.
    crisis_trigger: str | None = None

    # P0-A — 후속 질문 추천 3개. SuggestedFollowupsStage 가 채움.
    suggested_followups: list[str] | None = None
    # P1-J — 기도문/결의문 마무리 텍스트. ClosingTemplateStage 가 채움.
    closing: str | None = None

    # Phase 3 (Cache check — early return)
    cache_hit: bool = False
    cache_response: CacheHit | None = None  # apply_safety_layer 적용된 답변 보유

    # Cache invalidation trigger — IngestionJob.completed_at 의 max Unix ts.
    # _run_pre_pipeline 진입 시 1회 fetch 하여 ctx 에 주입. CacheCheckStage 와
    # PersistStage 가 이 값을 SemanticCacheService 에 그대로 전달한다.
    # corpus 가 갱신되면 이 값이 커지면서 기존 cache 가 자동 stale 처리된다.
    corpus_updated_at: float = 0.0

    # 메타데이터
    search_latency_ms: int = 0
    rerank_latency_ms: int = 0
    reranked: bool = False
    fallback_type: str = "none"

    # R1 Phase 3 N3: FSM 상태 (Stage 가 진입/완료 시 갱신, logger.warning 검증)
    pipeline_state: PipelineState = PipelineState.INIT
