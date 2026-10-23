"""관리자 RAG trace(`POST /admin/rag-trace`) 입출력 DTO. OpenAPI 계약의 원본이다."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.chat.types import AnswerMode
from app.modules.search.intent_classifier import Intent

SpanStatus = Literal["ok", "skipped", "error", "timeout", "cancelled", "short_circuit"]
StopAfter = Literal["search", "rerank", "full"]
CandidateOrigin = Literal["hybrid", "fallback_relaxed"]
# 후보가 처음 떨어진 단계. 파이프라인 순서대로 나열한다(kept = 끝까지 남음).
DropStage = Literal[
    "not_retrieved",
    "filtered",
    "fusion_cut",
    "below_threshold",
    "tier_not_reached",
    "merge_cut",
    "rerank_cut",
    "context_cut",
    "kept",
]


class TraceTurn(BaseModel):
    """플레이그라운드에 넣는 직전 대화 1개. DB 에 저장하지 않는다."""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class TraceOverrides(BaseModel):
    """이번 실행에만 적용하는 설정. None 이면 봇 설정을 그대로 쓴다."""

    rerank_enabled: bool | None = None
    query_rewrite_enabled: bool | None = None
    intent: Intent | None = None
    # 답변 뒤 병렬 후처리(추천 질문·마무리 문구·말씀 카드)를 건너뛴다. LLM 호출 3회를 아끼는 평가용.
    skip_postprocess: bool = False
    # 도입 전 검증 실험(기본 꺼짐). 운영 /chat 에는 없는 경로다.
    citation_check: bool = False  # C1: 구절 조회 + 사후 인용 게이트 + 근거 부족 거절
    decompose: bool = False  # C2: 질의 분해 → 병렬 검색 → 앱 수준 RRF
    wiki_first: bool = False  # C3: 용어 카드를 근거 앞에 넣는다


class RagTraceRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    # 봇 슬러그 (예: "all"). UUID 가 아니다.
    chatbot_id: str = "all"
    answer_mode: AnswerMode | None = None
    history: list[TraceTurn] = Field(default_factory=list, max_length=12)
    overrides: TraceOverrides = Field(default_factory=TraceOverrides)
    # search / rerank 이면 생성 단계를 실행하지 않는다(LLM 생성 비용 0).
    stop_after: StopAfter = "full"


class LlmUsage(BaseModel):
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class StageSpan(BaseModel):
    name: str
    kind: str
    status: SpanStatus
    start_ms: float
    duration_ms: float
    parent: str | None = None
    parallel_group: str | None = None
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    llm: LlmUsage | None = None
    # 생성 span 에만 있다 — trace 시작부터 첫 chunk 도착까지(ms).
    ttft_ms: float | None = None
    error: str | None = None


class CandidateRow(BaseModel):
    """후보 문서 1건이 단계별로 어디까지 살아남았는지. 순위는 1부터 센다."""

    key: str  # "volume:chunk_index"
    chunk_id: str
    volume: str
    source: str
    preview: str
    origin: CandidateOrigin
    tier_idx: int | None = None
    dense_rank: int | None = None
    sparse_rank: int | None = None
    fused_rank: int | None = None
    rrf_score: float | None = None
    qualified: bool | None = None
    rerank_score: float | None = None
    rerank_rank: int | None = None
    context_rank: int | None = None
    cited_rank: int | None = None
    # 같은 chunk 가 병합 목록에 두 번 이상 들어간 경우 두 번째부터 원본 key 를 가리킨다.
    duplicate_of: str | None = None
    # 병합 단계에서 이 chunk 를 찾아 준 카테고리들 (예: ["M", "U"]). 병합 전 탈락이면 빈 목록.
    matched_sources: list[str] = []
    # None = 판정 보류(rerank 가 예산 초과·오류로 끝나지 않아 검색 이후를 알 수 없음).
    drop_stage: DropStage | None


class TraceTier(BaseModel):
    sources: list[str]
    min_results: int
    score_threshold: float


class TraceWeightedSource(BaseModel):
    source: str
    weight: float
    score_threshold: float


class EffectiveConfig(BaseModel):
    """이번 실행에 실제로 적용된 값만 담는다(읽는 코드가 없는 설정 필드는 넣지 않는다)."""

    chatbot_id: str
    collection: str | None = None
    search_mode: Literal["cascading", "weighted"]
    tiers: list[TraceTier] = Field(default_factory=list)
    weighted_sources: list[TraceWeightedSource] = Field(default_factory=list)
    rerank_enabled: bool
    # stored | key_missing→default_{true|false} | override | system_default
    rerank_enabled_reason: str
    query_rewrite_enabled: bool
    query_rewrite_enabled_reason: str
    multiturn_enabled: bool
    intent_classifier_enabled: bool
    generation_model: str
    embedding_model: str
    # intent 별 값 — intent 가 정해진 뒤에만 채운다.
    rerank_top_k: int | None = None
    context_slice: int | None = None
    # 컬렉션 sparse vector modifier (none | idf). 조회 실패 시 None.
    sparse_modifier: str | None = None


class GenerationTrace(BaseModel):
    system_prompt: str
    context_prompt: str
    history_window: list[TraceTurn] = Field(default_factory=list)
    answer: str
    # 생성에 실제로 넣은 근거 순서("volume:chunk_index", 용어 카드는 "card:<slug>"). 답변 인용 대응용.
    context_keys: list[str] = Field(default_factory=list)
    # 재생성 등으로 여러 번 답했을 때 시도별 답변·판정. 한 번이면 비어 있다.
    attempts: list[dict[str, Any]] = Field(default_factory=list)


class TraceTotals(BaseModel):
    total_ms: float
    # 직렬 최상위 span 합 + 병렬 그룹별 최대값.
    critical_path_ms: float
    llm_calls: int
    input_tokens: int
    output_tokens: int


class RagTraceResponse(BaseModel):
    effective_config: EffectiveConfig | None = None
    intent: str | None = None
    resolved_answer_mode: str | None = None
    search_query: str | None = None
    rewritten: bool = False
    fallback_type: str = "none"
    spans: list[StageSpan] = Field(default_factory=list)
    candidates: list[CandidateRow] = Field(default_factory=list)
    generation: GenerationTrace | None = None
    totals: TraceTotals
    warnings: list[str] = Field(default_factory=list)
    partial: bool = False
    # 실험 경로가 남긴 판정 기록(라우팅·게이트·하위 질의·카드). 실험을 끄면 비어 있다.
    experiment: dict[str, Any] = Field(default_factory=dict)
