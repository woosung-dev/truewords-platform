"""RagTraceService — 운영 stage 를 그대로 태우는 저장 없는 replay.

Gemini 는 SDK 클라이언트(`gemini._client`) 자리에 가짜를 넣는다. 그래서 gemini.py 의
trace 훅(record_llm)까지 실제로 지난다. Qdrant 는 RawQdrantClient 가짜로 바꾼다.
"""

from __future__ import annotations

import asyncio
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

import app.core.common.gemini as gemini
import app.modules.chat.trace_service as trace_service
from app.modules.cache.schemas import CacheHit
from app.modules.cache.service import SemanticCacheService
from app.modules.chat.pipeline.stages.cache_check import CacheCheckStage
from app.modules.chat.pipeline.stages.closing_template import ClosingTemplateStage
from app.modules.chat.pipeline.stages.embedding import EmbeddingStage
from app.modules.chat.pipeline.stages.input_validation import InputValidationStage
from app.modules.chat.pipeline.stages.intent_classifier import IntentClassifierStage
from app.modules.chat.pipeline.stages.persist import PersistStage
from app.modules.chat.pipeline.stages.query_rewrite import QueryRewriteStage
from app.modules.chat.pipeline.stages.rerank import RerankStage
from app.modules.chat.pipeline.stages.runtime_config import RuntimeConfigStage
from app.modules.chat.pipeline.stages.safety_output import SafetyOutputStage
from app.modules.chat.pipeline.stages.search import SearchStage
from app.modules.chat.pipeline.stages.session import SessionStage
from app.modules.chat.pipeline.stages.suggested_followups import SuggestedFollowupsStage
from app.modules.chat.repository import ChatRepository
from app.modules.chat.trace import current_trace
from app.modules.chat.trace_schemas import RagTraceRequest
from app.modules.chat.trace_service import TRACE_STAGES, RagTraceService, rrf_expected
from app.modules.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
    TierConfig,
)
from app.modules.qdrant.raw_client import QdrantPoint
from app.modules.safety.output_filter import DISCLAIMER
from app.modules.search.intent_classifier import META_FALLBACK_ANSWER

# ---------------------------------------------------------------------------
# 가짜 Gemini / Qdrant
# ---------------------------------------------------------------------------


class _Usage:
    prompt_token_count = 10
    candidates_token_count = 5


class FakeModels:
    """google-genai `client.aio.models` 자리. system_instruction 으로 호출처를 구분한다."""

    def __init__(self) -> None:
        self.intent = "conceptual"
        self.stream_delay = 0.0
        self.generate_calls: list[str] = []
        self.stream_calls = 0

    async def embed_content(self, model, contents, config):
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[0.1, 0.2, 0.3])])

    async def generate_content(self, model, contents, config):
        sys = getattr(config, "system_instruction", None) or ""
        self.generate_calls.append(sys[:20])
        if "질문 분류기" in sys:
            text = self.intent
        elif "관련성 평가기" in sys:
            n = contents.count("[문단 ")
            text = json.dumps({"scores": [round(0.9 - i * 0.1, 2) for i in range(n)]})
        elif "후속 질문 추천기" in sys:
            text = "질문 하나인가요\n질문 둘인가요\n질문 셋인가요"
        else:
            text = "재작성된 질문"
        return SimpleNamespace(text=text, usage_metadata=_Usage())

    async def generate_content_stream(self, model, contents, config):
        self.stream_calls += 1
        delay = self.stream_delay

        async def gen():
            for text in ("참사랑은 ", "하나님의 사랑입니다."):
                if delay:
                    await asyncio.sleep(delay)
                yield SimpleNamespace(text=text, usage_metadata=None)
            yield SimpleNamespace(text="", usage_metadata=_Usage())

        return gen()


_IDS = [f"p{i}" for i in range(5)]


def _point(i: int, score: float) -> QdrantPoint:
    return QdrantPoint(
        id=_IDS[i],
        score=score,
        payload={"text": f"말씀 본문 {i}", "volume": "말씀선집 1권.pdf", "chunk_index": i, "source": ["A"]},
    )


class FakeQdrant:
    """fused 점수를 디버그 순위(dense=sparse=p0..p4)로 계산해 RRF 자기검증이 맞게 한다."""

    def __init__(self) -> None:
        self.query_calls = 0
        self.batch_calls = 0

    async def query_points(self, collection_name, **kwargs):
        self.query_calls += 1
        return [_point(i, rrf_expected(i + 1, i + 1)) for i in range(5)]

    async def query_batch_points(self, collection_name, searches):
        self.batch_calls += 1
        return [[_point(i, 1.0 - i * 0.1) for i in range(5)] for _ in searches]

    async def get_collection(self, collection_name):
        return {"config": {"params": {"sparse_vectors": {"sparse": {}}}}}


def _runtime_config(*, multiturn: bool = True, rerank: bool = True) -> ChatbotRuntimeConfig:
    return ChatbotRuntimeConfig(
        chatbot_id="all",
        name="전체",
        search=SearchModeConfig(
            mode="cascading",
            tiers=[TierConfig(sources=["A"], min_results=3, score_threshold=0.1)],
        ),
        generation=GenerationConfig(system_prompt="기본 프롬프트입니다."),
        retrieval=RetrievalConfig(
            rerank_enabled=rerank, query_rewrite_enabled=False, multiturn_enabled=multiturn
        ),
        safety=SafetyConfig(),
    )


@pytest.fixture
def harness():
    models = FakeModels()
    qdrant = FakeQdrant()
    chatbot_service = AsyncMock()
    chatbot_service.build_runtime_config.return_value = _runtime_config()
    chatbot_service.get_raw_search_tiers.return_value = {"tiers": [{"sources": ["A"]}]}
    cache_service = AsyncMock(spec=SemanticCacheService)
    cache_service.check_cache.return_value = None
    ingestion_repo = AsyncMock()
    ingestion_repo.get_max_completed_at.return_value = 0.0
    trace_service._sparse_modifier_cache.clear()
    with (
        patch.object(gemini, "_client", SimpleNamespace(aio=SimpleNamespace(models=models))),
        patch("app.modules.chat.pipeline.stages.search.get_raw_client", return_value=qdrant),
        patch("app.modules.chat.trace_service.get_raw_client", return_value=qdrant),
        patch(
            "app.modules.search.cascading.embed_sparse_async",
            new_callable=AsyncMock,
            return_value=([1, 2], [0.5, 0.5]),
        ),
    ):
        yield SimpleNamespace(
            models=models,
            qdrant=qdrant,
            chatbot_service=chatbot_service,
            cache_service=cache_service,
            service=RagTraceService(
                chatbot_service=chatbot_service,
                cache_service=cache_service,
                ingestion_repo=ingestion_repo,
            ),
        )
    trace_service._sparse_modifier_cache.clear()


def _top_level(resp) -> list[str]:
    return [s.name for s in resp.spans if s.parent is None and s.kind != "debug"]


# ---------------------------------------------------------------------------
# 1. 부수효과 0 · 2. Safety
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_full_run_writes_nothing_and_applies_safety(harness) -> None:
    with (
        patch.object(ChatRepository, "create_session", new_callable=AsyncMock) as create_session,
        patch.object(ChatRepository, "create_message", new_callable=AsyncMock) as create_message,
        patch.object(ChatRepository, "create_search_event", new_callable=AsyncMock) as create_event,
        patch.object(ChatRepository, "create_citations", new_callable=AsyncMock) as create_citations,
        patch.object(ChatRepository, "commit", new_callable=AsyncMock) as commit,
    ):
        resp = await harness.service.run(RagTraceRequest(query="참사랑이란 무엇인가요?"))

    for mock in (create_session, create_message, create_event, create_citations, commit):
        mock.assert_not_awaited()
    harness.cache_service.check_cache.assert_awaited_once()
    harness.cache_service.store_cache.assert_not_awaited()
    assert current_trace.get() is None  # 수집기 reset

    assert resp.partial is False
    assert resp.generation is not None
    # SafetyOutputStage — 면책 고지가 붙은 최종 답변
    assert resp.generation.answer.startswith("참사랑은 하나님의 사랑입니다.")
    assert DISCLAIMER in resp.generation.answer
    assert resp.generation.system_prompt.startswith("기본 프롬프트입니다.")
    assert "말씀 본문 0" in resp.generation.context_prompt

    gen_span = next(s for s in resp.spans if s.name == "generation")
    assert gen_span.ttft_ms is not None and gen_span.ttft_ms >= gen_span.start_ms
    # intent + rerank + followups + stream = LLM 4회, 토큰은 usage_metadata 합
    assert resp.totals.llm_calls == 4
    assert resp.totals.input_tokens == 40 and resp.totals.output_tokens == 20
    assert resp.totals.critical_path_ms <= resp.totals.total_ms + 1
    llm_parents = {s.parent for s in resp.spans if s.kind == "llm" and s.llm is not None}
    assert {"intent_classifier", "rerank", "generation", "suggested_followups"} <= llm_parents

    # 후보 표·설정
    assert [r.chunk_id for r in resp.candidates[:5]] == _IDS
    # 후보 5건 < conceptual context slice 6 → 모두 context 에 들어간다.
    assert {r.drop_stage for r in resp.candidates} == {"kept"}
    assert [r.cited_rank for r in resp.candidates] == [1, 2, 3, None, None]
    assert resp.candidates[0].dense_rank == 1 and resp.candidates[0].rerank_rank == 1
    assert not any(w.startswith("rrf_mismatch") for w in resp.warnings)
    cfg = resp.effective_config
    assert cfg is not None
    assert cfg.rerank_enabled is True and cfg.rerank_enabled_reason == "key_missing→default_true"
    assert cfg.sparse_modifier == "none"
    assert cfg.context_slice == 6 and cfg.rerank_top_k == 12


# ---------------------------------------------------------------------------
# 6. stage 계약 (정상 · meta · cache_would_hit)
# ---------------------------------------------------------------------------

_COUNTED_STAGES = (
    InputValidationStage,
    EmbeddingStage,
    CacheCheckStage,
    RuntimeConfigStage,
    IntentClassifierStage,
    QueryRewriteStage,
    SearchStage,
    RerankStage,
    SafetyOutputStage,
    SuggestedFollowupsStage,
    ClosingTemplateStage,
)


def _count_stage_calls():
    """각 Stage.execute 를 원본 그대로 실행하면서 호출 수를 센다."""
    patches = [
        patch.object(cls, "execute", autospec=True, side_effect=cls.execute) for cls in _COUNTED_STAGES
    ]
    patches += [
        patch.object(SessionStage, "execute", new_callable=AsyncMock),
        patch.object(PersistStage, "execute", new_callable=AsyncMock),
    ]
    return patches


@pytest.mark.asyncio
async def test_stage_contract_each_stage_runs_once_and_no_session_persist(harness) -> None:
    patches = _count_stage_calls()
    mocks = [p.start() for p in patches]
    try:
        resp = await harness.service.run(RagTraceRequest(query="참사랑이란 무엇인가요?"))
    finally:
        for p in patches:
            p.stop()
    *stage_mocks, session_mock, persist_mock = mocks
    assert [m.call_count for m in stage_mocks] == [1] * len(_COUNTED_STAGES)
    session_mock.assert_not_awaited()
    persist_mock.assert_not_awaited()
    assert _top_level(resp) == list(TRACE_STAGES)
    postprocess = [s for s in resp.spans if s.parallel_group == "postprocess"]
    assert {s.name for s in postprocess} == {"suggested_followups", "closing_template", "malssum_pick"}


@pytest.mark.asyncio
async def test_meta_intent_short_circuits_like_production(harness) -> None:
    harness.models.intent = "meta"
    resp = await harness.service.run(RagTraceRequest(query="오늘 날씨 어때요?"))

    assert _top_level(resp) == [
        "corpus_lookup",
        "input_validation",
        "embedding",
        "cache_check",
        "runtime_config",
        "intent_classifier",
        "safety_output",
    ]
    intent_span = next(s for s in resp.spans if s.name == "intent_classifier")
    assert intent_span.status == "short_circuit"
    assert "meta_terminated" in resp.warnings
    assert resp.candidates == []
    assert resp.generation is not None and resp.generation.answer.startswith(META_FALLBACK_ANSWER)
    assert harness.models.stream_calls == 0 and harness.qdrant.query_calls == 0


@pytest.mark.asyncio
async def test_cache_would_hit_is_reported_and_pipeline_continues(harness) -> None:
    harness.cache_service.check_cache.return_value = CacheHit(
        question="참사랑이란?", answer="캐시 답변", sources=[], score=0.97, created_at=0.0
    )
    resp = await harness.service.run(RagTraceRequest(query="참사랑이란 무엇인가요?"))

    assert "cache_would_hit" in resp.warnings
    cache_span = next(s for s in resp.spans if s.name == "cache_check")
    assert cache_span.output["would_hit"] is True and cache_span.output["score"] == 0.97
    assert _top_level(resp) == list(TRACE_STAGES)
    assert resp.generation is not None and "캐시 답변" not in resp.generation.answer


# ---------------------------------------------------------------------------
# 7. stop_after=search · override
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stop_after_search_makes_no_generation_calls(harness) -> None:
    resp = await harness.service.run(
        RagTraceRequest(
            query="참사랑이란 무엇인가요?",
            stop_after="search",
            overrides={"intent": "factoid", "query_rewrite_enabled": False},
        )
    )
    assert harness.models.generate_calls == []
    assert harness.models.stream_calls == 0
    assert _top_level(resp)[-1] == "search"
    assert resp.generation is None
    assert {r.drop_stage for r in resp.candidates} == {"kept"}
    intent_span = next(s for s in resp.spans if s.name == "intent_classifier")
    assert intent_span.status == "skipped" and resp.intent == "factoid"


@pytest.mark.asyncio
async def test_rerank_override_is_reflected_in_effective_config(harness) -> None:
    resp = await harness.service.run(
        RagTraceRequest(query="참사랑이란 무엇인가요?", stop_after="rerank", overrides={"rerank_enabled": False})
    )
    cfg = resp.effective_config
    assert cfg is not None
    assert cfg.rerank_enabled is False and cfg.rerank_enabled_reason == "override"
    rerank_span = next(s for s in resp.spans if s.name == "rerank")
    assert rerank_span.status == "skipped"
    assert harness.models.stream_calls == 0


# ---------------------------------------------------------------------------
# 8. multiturn · FSM 경고 0
# ---------------------------------------------------------------------------

_HISTORY = [
    {"role": "user", "content": "축복이 무엇인가요?"},
    {"role": "assistant", "content": "축복은 참부모님을 통해 받는 결혼입니다."},
]


@pytest.mark.asyncio
async def test_history_ignored_when_multiturn_off(harness, caplog) -> None:
    harness.chatbot_service.build_runtime_config.return_value = _runtime_config(multiturn=False)
    caplog.set_level(logging.WARNING, logger="app.modules.chat.pipeline.state")
    resp = await harness.service.run(RagTraceRequest(query="그건 언제 하나요?", history=_HISTORY))

    assert "history_ignored_multiturn_off" in resp.warnings
    assert resp.generation is not None and resp.generation.history_window == []
    # 이력이 없으니 캐시 조회가 일어나고 condense 재작성은 없다.
    harness.cache_service.check_cache.assert_awaited_once()
    assert resp.rewritten is False
    assert not [r for r in caplog.records if "precondition failed" in r.getMessage()]


@pytest.mark.asyncio
async def test_history_used_when_multiturn_on_without_fsm_warnings(harness, caplog) -> None:
    caplog.set_level(logging.WARNING, logger="app.modules.chat.pipeline.state")
    resp = await harness.service.run(RagTraceRequest(query="그건 언제 하나요?", history=_HISTORY))

    assert "history_ignored_multiturn_off" not in resp.warnings
    assert resp.generation is not None
    assert [t.role for t in resp.generation.history_window] == ["user", "assistant"]
    harness.cache_service.check_cache.assert_not_awaited()  # 후속 턴은 캐시 조회 스킵 (운영과 같음)
    assert resp.rewritten is True and resp.search_query == "재작성된 질문"
    assert not [r for r in caplog.records if "precondition failed" in r.getMessage()]


# ---------------------------------------------------------------------------
# 예산 초과 · pastoral 경고
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_budget_exceeded_returns_partial_trace(harness) -> None:
    harness.models.stream_delay = 1.0
    harness.service.budget_seconds = 0.3
    resp = await harness.service.run(RagTraceRequest(query="참사랑이란 무엇인가요?"))

    assert resp.partial is True
    assert "budget_exceeded" in resp.warnings
    gen_span = next(s for s in resp.spans if s.name == "generation")
    assert gen_span.status == "timeout"
    assert resp.candidates  # 검색까지는 끝났으므로 후보 표는 남는다
    assert current_trace.get() is None


@pytest.mark.asyncio
async def test_pastoral_stream_hotline_gap_is_only_warned(harness) -> None:
    resp = await harness.service.run(
        RagTraceRequest(query="참사랑이란 무엇인가요?", answer_mode="pastoral")
    )
    assert resp.resolved_answer_mode == "pastoral"
    assert "pastoral_hotline_missing_in_stream" in resp.warnings
    # 운영 스트림과 같게 답변 자체는 바꾸지 않는다.
    assert resp.generation is not None and "1393" not in resp.generation.answer


# ---------------------------------------------------------------------------
# 9. 수집기 꺼짐 — 운영 경로 훅은 no-op
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hooks_are_noop_without_collector(harness) -> None:
    assert current_trace.get() is None
    vec = await gemini.embed_dense_query("질문")
    text = await gemini.generate_text("프롬프트")
    assert vec == [0.1, 0.2, 0.3] and text == "재작성된 질문"
    assert current_trace.get() is None
