"""관리자 RAG trace 플레이그라운드 — 질문 1건을 운영 stage 로 다시 실행하고 trace 를 돌려준다.

- 운영 stage 객체와 운영 스트림 생성 함수(`generate_answer_stream` + `StreamingSanitizer`)를
  `ChatService.process_chat_stream` 과 같은 순서·인자로 부른다.
- SessionStage·PersistStage 는 실행하지 않는다. 메시지·SearchEvent·인용·캐시를 저장하지
  않는다(이 서비스는 ChatRepository 를 받지 않는다).
- 단계 내부 정보는 `chat.trace` 의 ContextVar 수집기로 모은다. 운영 경로는 수집기를
  설정하지 않으므로 영향이 없다.
- 전체 예산은 25초다(admin rewrite 프록시 기본 timeout 30초). 봇 설정 조회부터 잰다.
  넘으면 그때까지의 trace 를 partial=True 로 돌려준다. 디버그 조회·sparse modifier
  조회는 예산 뒤 2초 유예 안에서 함께 끝낸다(최악 약 27초 + 직렬화).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

from app.core.common.gemini import MODEL_EMBEDDING, MODEL_GENERATE
from app.core.common.ingestion_facade import IngestionJobRepository, get_corpus_updated_at
from app.modules.cache.service import SemanticCacheService
from app.modules.chat.history import estimate_tokens, select_history_window
from app.modules.chat.models import MessageRole, SessionMessage
from app.modules.chat.experiments import c1_citation, c2_decompose, c3_wiki, result_key
from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.pipeline.stages.cache_check import CacheCheckStage
from app.modules.chat.pipeline.stages.closing_template import ClosingTemplateStage
from app.modules.chat.pipeline.stages.embedding import EmbeddingStage
from app.modules.chat.pipeline.stages.generation import (
    PASTORAL_HOTLINE_FOOTER,
    configure_generation_for_mode,
)
from app.modules.chat.pipeline.stages.input_validation import InputValidationStage
from app.modules.chat.pipeline.stages.intent_classifier import IntentClassifierStage
from app.modules.chat.pipeline.stages.query_rewrite import QueryRewriteStage
from app.modules.chat.pipeline.stages.rerank import RerankStage
from app.modules.chat.pipeline.stages.runtime_config import RuntimeConfigStage
from app.modules.chat.pipeline.stages.safety_output import SafetyOutputStage
from app.modules.chat.pipeline.stages.search import SearchStage
from app.modules.chat.pipeline.stages.suggested_followups import SuggestedFollowupsStage
from app.modules.chat.pipeline.state import PipelineState
from app.modules.chat.prompt import build_context_prompt
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.service import DEFAULT_RUNTIME_CONFIG
from app.modules.chat.stream_generator import generate_answer_stream
from app.modules.chat.trace import (
    HybridCall,
    SpanRecord,
    TierRecord,
    TraceCollector,
    clip,
    current_trace,
    trace_span,
)
from app.modules.chat.trace_schemas import (
    CandidateRow,
    DropStage,
    EffectiveConfig,
    GenerationTrace,
    LlmUsage,
    RagTraceRequest,
    RagTraceResponse,
    StageSpan,
    TraceTier,
    TraceOverrides,
    TraceTotals,
    TraceTurn,
    TraceWeightedSource,
)
from app.modules.chatbot.runtime_config import ChatbotRuntimeConfig
from app.modules.chatbot.schemas import SearchTiersConfig
from app.modules.chatbot.service import ChatbotService
from app.modules.malssum.service import pick_malssum_for_answer
from app.modules.qdrant import get_raw_client
from app.modules.search.intent_classifier import (
    META_FALLBACK_ANSWER,
    generation_context_slice_for,
    rerank_top_k_for,
)
from app.modules.search.hybrid import SearchResult
from app.modules.safety.output_filter import StreamingSanitizer

logger = logging.getLogger(__name__)

# 실행 순서(최상위 stage span 이름). 테스트가 이 순서와 1회 실행을 계약으로 검사한다.
TRACE_STAGES: tuple[str, ...] = (
    "corpus_lookup",
    "input_validation",
    "embedding",
    "cache_check",
    "runtime_config",
    "intent_classifier",
    "query_rewrite",
    "search",
    "rerank",
    "generation",
    "safety_output",
    "suggested_followups",
    "closing_template",
    "malssum_pick",
)

TRACE_BUDGET_SECONDS = 25.0
_DEBUG_GRACE_SECONDS = 2.0
# Qdrant RRF 점수 = Σ 1/(RRF_K + rank0), rank0 는 0부터 센 순위. 첫 등수 = 0.5.
RRF_K = 2
# 디버그 조회(dense·sparse 각 50) 에서 받는 payload 필드.
_DEBUG_PAYLOAD_FIELDS = ["volume", "chunk_index", "source", "text"]
_DEBUG_LIMIT = 50
# 운영 cited 기준 — sources 이벤트·인용 카드에 나가는 상위 3건.
_CITED_N = 3
_PREVIEW_CHARS = 200
# rerank 비활성 시 RerankStage 가 남기는 개수.
_NO_RERANK_KEEP = 10
# 수집기 없이도 SessionMessage 를 만들 때 쓰는 가짜 세션 id (저장하지 않는다).
_TRACE_SESSION_ID = uuid.UUID(int=0)

# 컬렉션별 sparse modifier 캐시 (프로세스 수명). 컬렉션 설정은 재생성 전엔 바뀌지 않는다.
_sparse_modifier_cache: dict[str, str] = {}


@dataclass
class DebugLookup:
    """디버그 조회 결과 — chunk_id 순위 목록. 순서가 곧 순위다."""

    unfiltered_dense: list[str] = field(default_factory=list)
    unfiltered_sparse: list[str] = field(default_factory=list)
    # hybrid_calls 인덱스 → (dense, sparse). 필터가 없는 호출은 unfiltered 를 쓴다.
    per_call: dict[int, tuple[list[str], list[str]]] = field(default_factory=dict)
    payloads: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass
class _RunState:
    ctx: ChatContext | None = None
    warnings: list[str] = field(default_factory=list)
    partial: bool = False
    search_output: list[SearchResult] | None = None
    rerank_output: list[SearchResult] | None = None
    generation: GenerationTrace | None = None
    raw_tiers: dict | None = None
    overrides: TraceOverrides | None = None
    # 실험 경로(c1/c2/c3) 판정 기록. 실험을 끄면 비어 있다.
    experiment: dict[str, Any] = field(default_factory=dict)


def rrf_expected(dense_rank: int | None, sparse_rank: int | None) -> float:
    """1부터 센 dense/sparse 순위로 Qdrant RRF 점수를 다시 계산한다."""
    score = 0.0
    for rank in (dense_rank, sparse_rank):
        if rank is not None:
            score += 1.0 / (RRF_K + rank - 1)
    return score


# ---------------------------------------------------------------------------
# 후보 표 — drop_stage 판정
# ---------------------------------------------------------------------------


@dataclass
class _TierView:
    tier: TierRecord
    origin: str
    dense: list[str] | None  # None = 디버그 조회 없음
    sparse: list[str] | None
    fused: list[str]
    scores: list[float]


def _nth_index(items: list[str], value: str, n: int) -> int | None:
    seen = 0
    for i, item in enumerate(items):
        if item == value:
            if seen == n:
                return i
            seen += 1
    return None


def _rank(items: list[str] | None, value: str) -> int | None:
    if items is None or value not in items:
        return None
    return items.index(value) + 1


def _tier_views(c: TraceCollector, debug: DebugLookup | None) -> list[_TierView]:
    """tier 기록과 hybrid 호출(같은 source_filter)을 짝지어 순위 목록을 붙인다."""
    used: set[int] = set()
    views: list[_TierView] = []
    for tier in c.tiers:
        call_idx = next(
            (
                i
                for i, call in enumerate(c.hybrid_calls)
                if i not in used and call.source_filter == (tier.sources or None)
            ),
            None,
        )
        dense = sparse = None
        if call_idx is not None:
            used.add(call_idx)
            call = c.hybrid_calls[call_idx]
            if debug is not None:
                if call.query_filter is None:
                    dense, sparse = debug.unfiltered_dense, debug.unfiltered_sparse
                else:
                    dense, sparse = debug.per_call.get(call_idx, (None, None))
        views.append(
            _TierView(
                tier=tier,
                origin="hybrid",
                dense=dense,
                sparse=sparse,
                fused=[r.chunk_id for r in tier.results],
                scores=[r.score for r in tier.results],
            )
        )
    if c.fallback is not None:
        views.append(
            _TierView(
                tier=c.fallback,
                origin="fallback_relaxed",
                dense=debug.unfiltered_dense if debug else None,
                sparse=debug.unfiltered_sparse if debug else None,
                fused=[r.chunk_id for r in c.fallback.results],
                scores=[r.score for r in c.fallback.results],
            )
        )
    return views


def count_rrf_mismatches(views: list[_TierView]) -> int:
    """fused 점수와 디버그 순위로 다시 계산한 RRF 가 다른 후보 수 (필터 전파 실측)."""
    mismatches = 0
    for v in views:
        if v.dense is None or v.sparse is None:
            continue
        for cid, score in zip(v.fused, v.scores):
            expected = rrf_expected(_rank(v.dense, cid), _rank(v.sparse, cid))
            if abs(expected - score) > 1e-4:
                mismatches += 1
    return mismatches


def classify_drop(
    *,
    rerank_ran: bool,
    in_rerank_output: bool,
    in_context: bool,
    in_search_output: bool,
    in_merged: bool,
    in_fused: bool,
    in_filtered: bool,
    in_unreached_tier: bool,
    in_unfiltered: bool,
    rerank_incomplete: bool = False,
) -> DropStage | None:
    """가장 멀리 간 단계부터 거꾸로 보며 처음 실패한 단계를 고른다.

    파이프라인 순서: 조회 → 필터 → fusion → threshold → tier → 병합 → rerank → context.
    rerank_ran=False 는 rerank 출력이 없는 실행이라 검색 출력까지만 판정한다.
    그중 rerank_incomplete(rerank 도중 끊김)면 검색 출력 후보는 None(판정 보류)이다.
    """
    if rerank_ran and in_rerank_output:
        return "kept" if in_context else "context_cut"
    if in_search_output:
        if rerank_ran:
            return "rerank_cut"
        return None if rerank_incomplete else "kept"
    if in_merged:
        return "merge_cut"
    if in_fused:
        return "below_threshold"
    if in_filtered:
        return "fusion_cut"
    if in_unreached_tier:
        return "tier_not_reached"
    if in_unfiltered:
        return "filtered"
    return "not_retrieved"


def build_candidates(
    c: TraceCollector,
    debug: DebugLookup | None,
    *,
    search_output: list[SearchResult] | None,
    rerank_output: list[SearchResult] | None,
    context_slice: int | None,
    rerank_incomplete: bool = False,
) -> tuple[list[CandidateRow], list[str]]:
    """수집기 기록으로 후보 표와 경고를 만든다.

    drop_stage 는 후보가 가장 멀리 간 단계의 바로 다음 단계다(처음 실패한 단계).
    rerank_output 이 None 이면 rerank 를 거치지 않은 실행이다. stop_after=search 면
    검색 출력이 끝이고(kept), rerank_incomplete(예산 초과·오류로 rerank 미완료)면
    검색 출력 행은 판정을 보류한다(None).
    """
    views = _tier_views(c, debug)
    info: dict[str, dict[str, Any]] = {}

    def note(r: SearchResult) -> None:
        info.setdefault(
            r.chunk_id,
            {
                "volume": r.volume,
                "chunk_index": r.chunk_index,
                "source": r.source,
                "tags": [r.source] if r.source else [],
                "text": r.text,
            },
        )

    if debug is not None:
        for cid, p in debug.payloads.items():
            src = p.get("source")
            tags = list(src) if isinstance(src, list) else ([src] if isinstance(src, str) else [])
            info[cid] = {
                "volume": str(p.get("volume", "")),
                "chunk_index": p.get("chunk_index", 0),
                "source": tags[0] if tags else "",
                "tags": tags,
                "text": str(p.get("text", "")),
            }
    for v in views:
        for r in v.tier.results:
            note(r)
    for r in [*(c.merged or []), *(search_output or []), *(rerank_output or [])]:
        note(r)

    # rerank 출력은 SearchResult 를 새로 만들어 matched_sources 가 비므로 병합 목록에서 찾는다.
    matched: dict[str, list[str]] = {}
    for r in [*(c.merged or []), *(search_output or [])]:
        if r.matched_sources:
            matched.setdefault(r.chunk_id, list(r.matched_sources))

    merged_ids = [r.chunk_id for r in c.merged] if c.merged is not None else []
    search_ids = [r.chunk_id for r in search_output] if search_output is not None else []
    rerank_ids = [r.chunk_id for r in rerank_output] if rerank_output is not None else None
    rerank_inputs = [r.chunk_id for r in c.rerank.inputs] if c.rerank is not None else []
    unfiltered = set(debug.unfiltered_dense + debug.unfiltered_sparse) if debug else set()

    executed_cascading = sum(1 for t in c.tiers if t.mode == "cascading")
    unreached_sources: set[str] = set()
    for sources, _min in c.tier_plan[executed_cascading:]:
        unreached_sources.update(sources)

    # 행 순서: 최종 → 병합 → tier fused → 필터 조회 → 필터 없는 조회.
    order: list[str] = []
    for ids in (
        rerank_ids or [],
        search_ids,
        merged_ids,
        *[v.fused for v in views],
        *[(v.dense or []) + (v.sparse or []) for v in views],
        (debug.unfiltered_dense + debug.unfiltered_sparse) if debug else [],
    ):
        for cid in ids:
            if cid not in order:
                order.append(cid)

    rows: list[CandidateRow] = []
    duplicates = 0
    for cid in order:
        occurrences = max(merged_ids.count(cid), search_ids.count(cid), 1)
        duplicates += occurrences - 1
        meta = info.get(cid, {"volume": "", "chunk_index": 0, "source": "", "tags": [], "text": ""})
        key = f"{meta['volume']}:{meta['chunk_index']}"
        fused_views = [v for v in views if cid in v.fused]
        # threshold 를 넘긴 tier 를 먼저 고른다(fallback 으로 살아남은 후보는 relaxed 행으로).
        qualified_views = [
            v for v in fused_views if v.scores[v.fused.index(cid)] >= v.tier.threshold
        ]
        pick_views = qualified_views or fused_views
        for n in range(occurrences):
            tv = (
                pick_views[min(n, len(pick_views) - 1)]
                if pick_views
                else next(
                    (v for v in views if cid in (v.dense or []) or cid in (v.sparse or [])),
                    None,
                )
            )
            fused_pos = tv.fused.index(cid) if tv is not None and cid in tv.fused else None
            rrf = tv.scores[fused_pos] if tv is not None and fused_pos is not None else None
            if tv is not None:
                dense_rank, sparse_rank = _rank(tv.dense, cid), _rank(tv.sparse, cid)
            elif debug is not None:
                dense_rank = _rank(debug.unfiltered_dense, cid)
                sparse_rank = _rank(debug.unfiltered_sparse, cid)
            else:
                dense_rank = sparse_rank = None

            search_pos = _nth_index(search_ids, cid, n)
            rerank_pos = _nth_index(rerank_ids, cid, n) if rerank_ids is not None else None
            rerank_score = None
            if c.rerank is not None and c.rerank.scores is not None:
                in_pos = _nth_index(rerank_inputs, cid, n)
                if in_pos is not None and in_pos < len(c.rerank.scores):
                    rerank_score = c.rerank.scores[in_pos]
            in_context = (
                rerank_pos is not None and context_slice is not None and rerank_pos < context_slice
            )

            drop = classify_drop(
                rerank_ran=rerank_ids is not None,
                in_rerank_output=rerank_pos is not None,
                in_context=in_context,
                in_search_output=search_pos is not None,
                in_merged=_nth_index(merged_ids, cid, n) is not None,
                in_fused=bool(fused_views),
                in_filtered=tv is not None,
                in_unreached_tier=bool(set(meta["tags"]) & unreached_sources),
                in_unfiltered=cid in unfiltered,
                rerank_incomplete=rerank_incomplete,
            )

            rows.append(
                CandidateRow(
                    key=key,
                    chunk_id=cid,
                    volume=meta["volume"],
                    source=meta["source"],
                    preview=meta["text"][:_PREVIEW_CHARS],
                    origin=tv.origin if tv is not None else "hybrid",  # type: ignore[arg-type]
                    tier_idx=tv.tier.tier_idx if tv is not None else None,
                    dense_rank=dense_rank,
                    sparse_rank=sparse_rank,
                    fused_rank=fused_pos + 1 if fused_pos is not None else None,
                    rrf_score=rrf,
                    qualified=(rrf >= tv.tier.threshold) if tv is not None and rrf is not None else None,
                    rerank_score=rerank_score,
                    rerank_rank=(rerank_pos + 1) if rerank_pos is not None and c.rerank is not None else None,
                    context_rank=(rerank_pos + 1) if in_context and rerank_pos is not None else None,
                    cited_rank=(rerank_pos + 1)
                    if rerank_pos is not None and rerank_pos < _CITED_N
                    else None,
                    duplicate_of=key if n > 0 else None,
                    matched_sources=matched.get(cid, []),
                    drop_stage=drop,
                )
            )

    warnings: list[str] = []
    if duplicates:
        warnings.append(f"duplicates:{duplicates}")
    mismatches = count_rrf_mismatches(views)
    if mismatches:
        warnings.append(f"rrf_mismatch:{mismatches}")
    filtered_n = sum(1 for r in rows if r.drop_stage == "filtered")
    if filtered_n:
        warnings.append(f"filter_loss:{filtered_n}")
    return rows, warnings


# ---------------------------------------------------------------------------
# 서비스
# ---------------------------------------------------------------------------


def _ms(seconds: float) -> float:
    return round(seconds * 1000, 2)


class RagTraceService:
    """관리자 플레이그라운드 — 저장하지 않는 replay."""

    def __init__(
        self,
        chatbot_service: ChatbotService,
        cache_service: SemanticCacheService | None = None,
        ingestion_repo: IngestionJobRepository | None = None,
        *,
        budget_seconds: float = TRACE_BUDGET_SECONDS,
    ) -> None:
        self.chatbot_service = chatbot_service
        self.ingestion_repo = ingestion_repo
        self.budget_seconds = budget_seconds
        # 운영 ChatService 와 같은 stage 객체. Session/Persist 는 만들지 않는다.
        self.input_validation_stage = InputValidationStage()
        self.embedding_stage = EmbeddingStage()
        self.cache_check_stage = CacheCheckStage(cache_service)
        self.runtime_config_stage = RuntimeConfigStage(
            chatbot_service, default_config=DEFAULT_RUNTIME_CONFIG
        )
        self.intent_classifier_stage = IntentClassifierStage()
        self.query_rewrite_stage = QueryRewriteStage()
        self.search_stage = SearchStage(default_tiers=DEFAULT_RUNTIME_CONFIG.search.tiers)
        self.rerank_stage = RerankStage()
        self.safety_output_stage = SafetyOutputStage()
        self.suggested_followups_stage = SuggestedFollowupsStage()
        self.closing_template_stage = ClosingTemplateStage()

    async def run(self, req: RagTraceRequest) -> RagTraceResponse:
        state = _RunState()
        loop = asyncio.get_running_loop()
        # 예산은 봇 설정 조회부터 잰다. 후처리(디버그·sparse modifier)는 유예까지만 쓴다.
        deadline = loop.time() + self.budget_seconds
        grace_deadline = deadline + _DEBUG_GRACE_SECONDS
        # 봇 설정을 먼저 읽는다 — 없는 봇은 404 로 바로 끝낸다(HTTPException 전파).
        pre_cfg = (
            await self.chatbot_service.build_runtime_config(req.chatbot_id)
            or DEFAULT_RUNTIME_CONFIG
        )
        state.raw_tiers = await self.chatbot_service.get_raw_search_tiers(req.chatbot_id)

        collector = TraceCollector()
        token = current_trace.set(collector)
        try:
            try:
                async with asyncio.timeout_at(deadline):
                    await self._execute(req, pre_cfg, state)
            except TimeoutError:
                collector.mark_timeout()
                state.partial = True
                state.warnings.append("budget_exceeded")
            except Exception as exc:  # stage 오류도 trace 로 돌려준다(span 에 error 기록됨)
                logger.warning("rag_trace: stage 실패 %s", type(exc).__name__)
                state.partial = True
                state.warnings.append(f"stage_error:{type(exc).__name__}")
            pipeline_end = perf_counter()

            # 예산을 다 쓴 경우에도 순위 칸을 채우도록 같은 유예 안에서 병렬로 조회한다.
            debug, sparse_modifier = await asyncio.gather(
                self._debug_lookup_within(collector, state, grace_deadline),
                self._sparse_modifier(state.ctx, grace_deadline),
            )
        finally:
            current_trace.reset(token)

        return self._build_response(
            req, collector, state, debug, pipeline_end=pipeline_end, sparse_modifier=sparse_modifier
        )

    # ---- 파이프라인 ----------------------------------------------------------

    async def _execute(
        self, req: RagTraceRequest, pre_cfg: ChatbotRuntimeConfig, state: _RunState
    ) -> None:
        state.overrides = req.overrides
        ctx = ChatContext(
            request=ChatRequest(
                query=req.query, chatbot_id=req.chatbot_id, answer_mode=req.answer_mode
            )
        )
        state.ctx = ctx

        async with trace_span("corpus_lookup", "db") as span:
            # service.py _run_pre_pipeline 과 같다 — cache invalidation 기준 시각.
            if self.ingestion_repo is not None:
                ctx.corpus_updated_at = await get_corpus_updated_at(self.ingestion_repo)
            elif span is not None:
                span.status = "skipped"

        async with trace_span("input_validation"):
            ctx = await self.input_validation_stage.execute(ctx)

        # SessionStage 대신 — 멀티턴이 꺼진 봇이면 이력을 무시한다(운영과 같은 동작).
        if req.history:
            if not pre_cfg.retrieval.multiturn_enabled:
                state.warnings.append("history_ignored_multiturn_off")
            else:
                ctx.history = [
                    SessionMessage(
                        session_id=_TRACE_SESSION_ID,
                        role=MessageRole(turn.role),
                        content=turn.content,
                        token_count=estimate_tokens(turn.content),
                    )
                    for turn in req.history
                ]
        # FSM 코드는 그대로 두고 SessionStage 가 남겼을 상태만 맞춘다.
        ctx.pipeline_state = PipelineState.SESSION_READY

        async with trace_span("embedding") as span:
            ctx = await self.embedding_stage.execute(ctx)
            if span is not None:
                span.output = {"dim": len(ctx.query_embedding or [])}

        async with trace_span("cache_check") as span:
            ctx = await self.cache_check_stage.execute(ctx)
            if ctx.cache_hit and ctx.cache_response is not None:
                # 운영이라면 여기서 캐시 답변으로 끝난다. 점수만 남기고 계속 진행한다.
                if span is not None:
                    # 캐시에 저장된 질문은 다른 사용자의 원문이라 점수만 남긴다.
                    span.output = {"would_hit": True, "score": ctx.cache_response.score}
                state.warnings.append("cache_would_hit")
                ctx.cache_hit = False
                ctx.cache_response = None
                ctx.pipeline_state = PipelineState.CACHE_CHECKED
            elif span is not None:
                span.output = {"would_hit": False, "skipped_followup_turn": bool(ctx.history)}

        async with trace_span("runtime_config") as span:
            ctx = await self.runtime_config_stage.execute(ctx)
            ctx.runtime_config = _apply_overrides(ctx.runtime_config, req)
            if span is not None and ctx.runtime_config is not None:
                span.output = {
                    "rerank_enabled": ctx.runtime_config.retrieval.rerank_enabled,
                    "query_rewrite_enabled": ctx.runtime_config.retrieval.query_rewrite_enabled,
                    "search_mode": ctx.runtime_config.search.mode,
                }

        async with trace_span("intent_classifier") as span:
            if req.overrides.intent is not None:
                # 강제 intent — 분류 LLM 을 부르지 않고 IntentClassifierStage 와 같은 규칙으로 적용.
                ctx.intent = req.overrides.intent
                if ctx.intent == "meta" and not ctx.history:
                    ctx.answer = META_FALLBACK_ANSWER
                    ctx.results = []
                    ctx.pipeline_state = PipelineState.META_TERMINATED
                else:
                    if ctx.intent == "meta":
                        ctx.intent = "conceptual"
                    ctx.pipeline_state = PipelineState.INTENT_CLASSIFIED
                if span is not None:
                    span.status = "skipped"
            else:
                ctx = await self.intent_classifier_stage.execute(ctx)
            if span is not None:
                span.output = {"intent": ctx.intent}
                if ctx.pipeline_state == PipelineState.META_TERMINATED:
                    span.status = "short_circuit"

        if ctx.pipeline_state == PipelineState.META_TERMINATED:
            # 운영 service.py 와 같다 — Search/Rerank/Generation 없이 Safety 만.
            state.warnings.append("meta_terminated")
            async with trace_span("safety_output"):
                ctx = await self.safety_output_stage.execute(ctx)
            state.generation = GenerationTrace(
                system_prompt="", context_prompt="", answer=ctx.answer or ""
            )
            return

        async with trace_span("query_rewrite", input={"query": req.query}) as span:
            ctx = await self.query_rewrite_stage.execute(ctx)
            if span is not None:
                span.output = {
                    "search_query": ctx.search_query,
                    "rewritten": ctx.rewritten_query is not None,
                }

        async with trace_span("search") as span:
            decomposed = None
            if req.overrides.decompose and ctx.intent in ("conceptual", "reasoning"):
                async with trace_span("decompose"):
                    decomposed = await c2_decompose.decomposed_search(ctx, self.search_stage)
                state.experiment["c2"] = decomposed[1] if decomposed else {"fallback": True}
            if decomposed is not None:
                ctx.results = decomposed[0]
                # 계획 실패(fallback)면 원 질의 검색 결과 그대로라 후보 표도 정확하다.
                if not decomposed[1].get("fallback"):
                    state.warnings.append("decompose_candidates_approx")
            else:
                ctx = await self.search_stage.execute(ctx)
            state.search_output = list(ctx.results)
            if span is not None:
                span.output = {
                    "n_results": len(ctx.results),
                    "fallback_type": ctx.fallback_type,
                    "query_metadata": ctx.query_metadata,
                }
        if req.stop_after == "search":
            return

        async with trace_span("rerank") as span:
            n_in = len(ctx.results)
            ctx = await self.rerank_stage.execute(ctx)
            state.rerank_output = list(ctx.results)
            if span is not None:
                span.output = {
                    "n_in": n_in,
                    "n_out": len(ctx.results),
                    "reranked": ctx.reranked,
                    "top_k": rerank_top_k_for(ctx.intent)
                    if ctx.runtime_config and ctx.runtime_config.retrieval.rerank_enabled
                    else _NO_RERANK_KEEP,
                }
                if not (ctx.runtime_config and ctx.runtime_config.retrieval.rerank_enabled):
                    span.status = "skipped"
        if req.overrides.citation_check:
            async with trace_span("passage_lookup"):
                sources = [w.source for w in ctx.runtime_config.search.weighted_sources] if (
                    ctx.runtime_config and ctx.runtime_config.search.weighted_sources
                ) else []
                ctx.results, lookup = await c1_citation.passage_lookup(
                    ctx.request.query, list(ctx.results), sources=sources
                )
            state.experiment["c1"] = {"lookup": lookup}
            if lookup.get("routed"):
                state.experiment["c1"]["ranking"] = [
                    result_key(r.volume, r.chunk_index) for r in ctx.results
                ]
        if req.stop_after == "rerank":
            return

        if req.overrides.citation_check and not state.experiment["c1"]["lookup"].get("routed"):
            refuse, refusal = c1_citation.should_refuse(ctx.results, reranked=bool(ctx.reranked))
            state.experiment["c1"]["refusal"] = refusal
            if refuse:
                ctx.answer = c1_citation.REFUSAL_ANSWER
                state.generation = GenerationTrace(system_prompt="", context_prompt="", answer=ctx.answer)
                ctx.pipeline_state = PipelineState.GENERATED
                async with trace_span("safety_output"):
                    ctx = await self.safety_output_stage.execute(ctx)
                state.generation.answer = ctx.answer or ""
                return

        await self._generate(ctx, state)

        async with trace_span("safety_output"):
            ctx = await self.safety_output_stage.execute(ctx)
        if state.generation is not None:
            state.generation.answer = ctx.answer or ""
        if req.overrides.skip_postprocess:
            state.warnings.append("postprocess_skipped")
            return

        async def _in_group(name: str, fn: Callable[[], Awaitable[Any]]) -> Any:
            async with trace_span(name, parallel_group="postprocess"):
                return await fn()

        # 운영과 같은 병렬 후처리. 결과는 trace 에만 남긴다.
        await asyncio.gather(
            _in_group("suggested_followups", lambda: self.suggested_followups_stage.execute(ctx)),
            _in_group("closing_template", lambda: self.closing_template_stage.execute(ctx)),
            _in_group("malssum_pick", lambda: pick_malssum_for_answer(ctx.answer or "")),
            return_exceptions=True,
        )

    async def _generate(self, ctx: ChatContext, state: _RunState) -> None:
        """운영 스트림 생성 경로(service.py process_chat_stream)를 그대로 따른다."""
        async with trace_span("generation", "llm") as span:
            gen_cfg = configure_generation_for_mode(ctx)
            assert gen_cfg is not None, "trace 경로엔 runtime_config 가 필요합니다"
            context_results = ctx.results[: generation_context_slice_for(ctx.intent)]
            context_keys = [result_key(r.volume, r.chunk_index) for r in context_results]
            ov = state.overrides
            if ov is not None and ov.wiki_first:
                async with trace_span("wiki_route"):
                    context_results, context_keys, wiki = c3_wiki.apply_cards(
                        ctx.request.query, ctx.intent, context_results
                    )
                state.experiment["c3"] = wiki
            history_window = select_history_window(ctx.history) or None
            state.generation = GenerationTrace(
                system_prompt=gen_cfg.system_prompt,
                context_prompt=build_context_prompt(
                    ctx.request.query, context_results, history=history_window
                ),
                history_window=[
                    TraceTurn(role=role, content=content)  # type: ignore[arg-type]
                    for role, content in (history_window or [])
                ],
                answer="",
                context_keys=context_keys,
            )
            sanitizer = StreamingSanitizer()
            full_answer: list[str] = []
            abort_guidance: str | None = None
            async for chunk in generate_answer_stream(
                ctx.request.query,
                context_results,
                generation_config=gen_cfg,
                history=history_window,
            ):
                if span is not None and span.ttft_ms is None:
                    collector = current_trace.get()
                    if collector is not None:
                        span.ttft_ms = collector.ms(perf_counter())
                released = sanitizer.feed(chunk)
                if sanitizer.aborted:
                    abort_guidance = released
                    break
                full_answer.append(chunk)
            if not sanitizer.aborted:
                sanitizer.flush()
            ctx.answer = abort_guidance if abort_guidance is not None else "".join(full_answer)
            if ov is not None and ov.citation_check and not sanitizer.aborted:
                async with trace_span("citation_gate"):
                    ctx.answer, gate, attempts = await c1_citation.citation_gate(
                        ctx.answer,
                        context_results,
                        regenerate=lambda note: self._regenerate(
                            ctx, context_results, gen_cfg, history_window, note
                        ),
                    )
                state.experiment.setdefault("c1", {})["gate"] = gate
                state.generation.attempts = attempts
            state.generation.answer = ctx.answer
            # 스트림 경로는 GENERATED 를 남기지 않는다. trace 는 경고 없이 진행하려고 맞춘다.
            ctx.pipeline_state = PipelineState.GENERATED
            if span is not None:
                span.output = {
                    "answer_chars": len(ctx.answer or ""),
                    "context_n": len(context_results),
                    "sanitizer_aborted": sanitizer.aborted,
                    "resolved_answer_mode": ctx.resolved_answer_mode,
                }
        # [확인 필요] 동기 GenerationStage 는 pastoral 답변에 핫라인을 붙이지만 스트림 경로는
        # 붙이지 않는다. 수정은 별건 — 여기서는 차이만 경고로 남긴다.
        footer_marker = PASTORAL_HOTLINE_FOOTER.strip().split("\n")[1]
        if ctx.resolved_answer_mode == "pastoral" and footer_marker not in (ctx.answer or ""):
            state.warnings.append("pastoral_hotline_missing_in_stream")

    # ---- 디버그 조회 -----------------------------------------------------------

    async def _regenerate(
        self,
        ctx: ChatContext,
        context_results: list[SearchResult],
        gen_cfg: Any,
        history_window: list[tuple[str, str]] | None,
        note: str,
    ) -> str:
        """C1 게이트의 재생성 1회. 같은 근거·설정에 검토 메모를 질문 뒤에 붙인다."""
        async with trace_span("regenerate", "llm"):
            parts: list[str] = []
            async for chunk in generate_answer_stream(
                f"{ctx.request.query}\n\n[검토 메모] {note}",
                context_results,
                generation_config=gen_cfg,
                history=history_window,
            ):
                parts.append(chunk)
            return "".join(parts)

    async def _debug_lookup_within(
        self, c: TraceCollector, state: _RunState, until: float
    ) -> DebugLookup | None:
        if state.search_output is None:
            return None
        try:
            async with asyncio.timeout_at(until):
                return await self._debug_lookup(c)
        except Exception as exc:  # 디버그 조회 실패는 순위 칸만 비운다
            logger.warning("rag_trace: 디버그 조회 실패 %s", type(exc).__name__)
            state.warnings.append("debug_lookup_failed")
            return None

    async def _debug_lookup(self, c: TraceCollector) -> DebugLookup | None:
        """운영과 같은 필터의 dense·sparse 50, 필터 없는 dense·sparse 50 을 한 번에 조회한다."""
        if c.query_vectors is None:
            return None
        async with trace_span("debug_lookup", "debug"):
            collection, dense, sparse = c.query_vectors
            searches = _lookup_bodies(dense, sparse, None, _DEBUG_LIMIT)
            slots: dict[int, int] = {}
            for i, call in enumerate(c.hybrid_calls):
                if call.query_filter is None:
                    continue
                slots[i] = len(searches)
                searches += _lookup_bodies(
                    call.dense, call.sparse, call.query_filter, call.prefetch_limit
                )
            batches = await get_raw_client().query_batch_points(collection, searches)
        lookup = DebugLookup()
        for batch in batches:
            for p in batch:
                lookup.payloads.setdefault(str(p.id), p.payload or {})
        ids = [[str(p.id) for p in batch] for batch in batches]
        lookup.unfiltered_dense, lookup.unfiltered_sparse = ids[0], ids[1]
        for call_idx, slot in slots.items():
            lookup.per_call[call_idx] = (ids[slot], ids[slot + 1])
        return lookup

    async def _sparse_modifier(self, ctx: ChatContext | None, until: float) -> str | None:
        collection = ctx.resolved_collections.main if ctx and ctx.resolved_collections else None
        if collection is None:
            return None
        if collection in _sparse_modifier_cache:
            return _sparse_modifier_cache[collection]
        try:
            async with asyncio.timeout_at(until):
                info = await get_raw_client().get_collection(collection)
        except Exception as exc:
            logger.warning("rag_trace: 컬렉션 정보 조회 실패 %s", type(exc).__name__)
            return None
        sparse_cfg = (info.get("config", {}).get("params", {}).get("sparse_vectors") or {}).get(
            "sparse"
        ) or {}
        modifier = str(sparse_cfg.get("modifier") or "none").lower()
        _sparse_modifier_cache[collection] = modifier
        return modifier

    # ---- 응답 조립 ------------------------------------------------------------

    def _build_response(
        self,
        req: RagTraceRequest,
        c: TraceCollector,
        state: _RunState,
        debug: DebugLookup | None,
        *,
        pipeline_end: float,
        sparse_modifier: str | None,
    ) -> RagTraceResponse:
        ctx = state.ctx
        context_slice = generation_context_slice_for(ctx.intent) if ctx else None
        candidates: list[CandidateRow] = []
        if state.search_output is not None:
            # rerank 까지 가야 했는데(stop_after≠search) 출력이 없으면 rerank 도중 끊긴 실행이다.
            rerank_incomplete = req.stop_after != "search" and state.rerank_output is None
            candidates, cand_warnings = build_candidates(
                c,
                debug,
                search_output=state.search_output,
                rerank_output=state.rerank_output,
                context_slice=context_slice if state.rerank_output is not None else None,
                rerank_incomplete=rerank_incomplete,
            )
            state.warnings.extend(cand_warnings)
            if rerank_incomplete:
                state.warnings.append("candidates_incomplete")
        if c.rerank is not None and c.rerank.status != "ok":
            state.warnings.append(f"rerank_{c.rerank.status}")

        spans = [_to_stage_span(c, s) for s in c.spans]
        return RagTraceResponse(
            effective_config=self._effective_config(req, ctx, state, sparse_modifier),
            intent=ctx.intent if ctx else None,
            resolved_answer_mode=ctx.resolved_answer_mode if ctx else None,
            search_query=ctx.search_query if ctx else None,
            rewritten=bool(ctx and ctx.rewritten_query),
            fallback_type=ctx.fallback_type if ctx else "none",
            spans=spans,
            candidates=candidates,
            generation=state.generation,
            totals=_totals(c, pipeline_end),
            warnings=state.warnings,
            partial=state.partial,
            experiment=state.experiment,
        )

    def _effective_config(
        self,
        req: RagTraceRequest,
        ctx: ChatContext | None,
        state: _RunState,
        sparse_modifier: str | None,
    ) -> EffectiveConfig | None:
        if ctx is None or ctx.runtime_config is None:
            return None
        rc = ctx.runtime_config
        raw = state.raw_tiers

        def reason(key: str, override: bool | None) -> str:
            if override is not None:
                return "override"
            if raw is None:
                return "system_default"
            if key in raw:
                return "stored"
            # 키 없음 → 런타임이 쓰는 SearchTiersConfig 기본값을 그대로 표시한다.
            default = SearchTiersConfig.model_fields[key].default
            return f"key_missing→default_{str(default).lower()}"

        tiers = rc.search.tiers or DEFAULT_RUNTIME_CONFIG.search.tiers
        return EffectiveConfig(
            chatbot_id=req.chatbot_id,
            collection=ctx.resolved_collections.main if ctx.resolved_collections else None,
            search_mode=rc.search.mode,
            tiers=[
                TraceTier(sources=list(t.sources), min_results=t.min_results, score_threshold=t.score_threshold)
                for t in tiers
            ]
            if rc.search.mode == "cascading"
            else [],
            weighted_sources=[
                TraceWeightedSource(source=w.source, weight=w.weight, score_threshold=w.score_threshold)
                for w in rc.search.weighted_sources
            ],
            rerank_enabled=rc.retrieval.rerank_enabled,
            rerank_enabled_reason=reason("rerank_enabled", req.overrides.rerank_enabled),
            query_rewrite_enabled=rc.retrieval.query_rewrite_enabled,
            query_rewrite_enabled_reason=reason(
                "query_rewrite_enabled", req.overrides.query_rewrite_enabled
            ),
            multiturn_enabled=rc.retrieval.multiturn_enabled,
            intent_classifier_enabled=rc.retrieval.intent_classifier_enabled,
            generation_model=MODEL_GENERATE,
            embedding_model=MODEL_EMBEDDING,
            rerank_top_k=rerank_top_k_for(ctx.intent) if ctx.intent else None,
            context_slice=generation_context_slice_for(ctx.intent) if ctx.intent else None,
            sparse_modifier=sparse_modifier,
        )


def _apply_overrides(
    rc: ChatbotRuntimeConfig | None, req: RagTraceRequest
) -> ChatbotRuntimeConfig | None:
    """frozen 설정에 이번 실행의 override 만 덮는다."""
    if rc is None:
        return None
    update: dict[str, bool] = {}
    if req.overrides.rerank_enabled is not None:
        update["rerank_enabled"] = req.overrides.rerank_enabled
    if req.overrides.query_rewrite_enabled is not None:
        update["query_rewrite_enabled"] = req.overrides.query_rewrite_enabled
    if not update:
        return rc
    return rc.model_copy(update={"retrieval": rc.retrieval.model_copy(update=update)})


def _lookup_bodies(
    dense: list[float],
    sparse: tuple[list[int], list[float]],
    query_filter: dict | None,
    limit: int,
) -> list[dict]:
    bodies: list[dict] = [
        {"query": dense, "using": "dense"},
        {"query": {"indices": sparse[0], "values": sparse[1]}, "using": "sparse"},
    ]
    for body in bodies:
        body.update({"limit": limit, "with_payload": _DEBUG_PAYLOAD_FIELDS, "with_vector": False})
        if query_filter is not None:
            body["filter"] = query_filter
    return bodies


def _to_stage_span(c: TraceCollector, s: SpanRecord) -> StageSpan:
    end = s.end if s.end is not None else perf_counter()
    return StageSpan(
        name=s.name,
        kind=s.kind,
        status=s.status,  # type: ignore[arg-type]
        start_ms=c.ms(s.start),
        duration_ms=_ms(end - s.start),
        parent=s.parent,
        parallel_group=s.parallel_group,
        input=clip(s.input),
        output=clip(s.output),
        llm=LlmUsage(**s.llm) if s.llm else None,
        ttft_ms=s.ttft_ms,
        error=s.error,
    )


def _totals(c: TraceCollector, pipeline_end: float) -> TraceTotals:
    """critical path = 직렬 최상위 span 합 + 병렬 그룹별 최대값 (debug span 제외)."""
    serial = 0.0
    groups: dict[str, float] = {}
    for s in c.spans:
        if s.parent is not None or s.kind == "debug":
            continue
        duration = ((s.end if s.end is not None else pipeline_end) - s.start)
        if s.parallel_group:
            groups[s.parallel_group] = max(groups.get(s.parallel_group, 0.0), duration)
        else:
            serial += duration
    llm_spans = [s for s in c.spans if s.llm is not None and s.kind == "llm"]
    return TraceTotals(
        total_ms=_ms(pipeline_end - c.t0),
        critical_path_ms=_ms(serial + sum(groups.values())),
        llm_calls=len(llm_spans),
        input_tokens=sum((s.llm or {}).get("input_tokens") or 0 for s in llm_spans),
        output_tokens=sum((s.llm or {}).get("output_tokens") or 0 for s in llm_spans),
    )


__all__ = [
    "TRACE_STAGES",
    "DebugLookup",
    "HybridCall",
    "RagTraceService",
    "build_candidates",
    "classify_drop",
    "count_rrf_mismatches",
    "rrf_expected",
]
