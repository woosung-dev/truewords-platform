"""C2 질의 분해 실험 — planner·병렬 검색·앱 수준 RRF. 네트워크 없이 검색·LLM 을 가짜로 둔다.

trace 훅(factoid 미호출·span 구조)은 tests/chat/test_rag_trace_service.py 의 harness 로 본다.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

import app.core.common.gemini as gemini
from app.modules.chat.experiments import c2_decompose
from app.modules.chat.experiments.c2_decompose import decomposed_search, plan_sub_queries, rrf_merge
from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.pipeline.state import PipelineState
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.trace import TraceCollector, current_trace
from app.modules.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
    WeightedSourceConfig,
)
from app.modules.search.collection_resolver import ResolvedCollections
from app.modules.search.hybrid import SearchResult
from app.modules.search.weighted import WeightedConfig

QUERY = "참사랑과 참가정은 어떤 관계인가요?"


def _r(name: str, score: float = 0.5, **kw) -> SearchResult:
    """name = 권 이름. chunk_index 는 0 고정이라 name 이 곧 identity 다."""
    return SearchResult(text=f"본문 {name}", volume=name, chunk_index=0, score=score, **kw)


def _names(results: list[SearchResult]) -> list[str]:
    return [r.volume for r in results]


def _runtime_config() -> ChatbotRuntimeConfig:
    return ChatbotRuntimeConfig(
        chatbot_id="all",
        name="전체",
        search=SearchModeConfig(
            mode="weighted",
            weighted_sources=[
                WeightedSourceConfig(source="M", weight=2.0, score_threshold=0.1),
                WeightedSourceConfig(source="U", weight=1.0, score_threshold=0.2),
            ],
        ),
        generation=GenerationConfig(system_prompt="기본"),
        retrieval=RetrievalConfig(rerank_enabled=True, query_rewrite_enabled=False),
        safety=SafetyConfig(),
    )


def _ctx(intent: str = "conceptual") -> ChatContext:
    ctx = ChatContext(request=ChatRequest(query=QUERY, chatbot_id="all"))
    ctx.runtime_config = _runtime_config()
    ctx.intent = intent  # type: ignore[assignment]
    ctx.pipeline_state = PipelineState.QUERY_REWRITTEN
    return ctx


class FakeSearchStage:
    """SearchStage 자리 — 원 질의 결과를 ctx 에 채운다."""

    def __init__(self, results: list[SearchResult], before=None) -> None:
        self.default_tiers: list = []
        self.results = results
        self.before = before
        self.calls = 0

    async def execute(self, ctx: ChatContext) -> ChatContext:
        self.calls += 1
        if self.before is not None:
            await self.before()
        ctx.results = list(self.results)
        ctx.resolved_collections = ResolvedCollections(main="col", cache="cache")
        ctx.query_metadata = {"volume": 3}
        ctx.pipeline_state = PipelineState.SEARCHED
        return ctx


def _planner_returns(payload) -> AsyncMock:
    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return AsyncMock(return_value=text)


# ---------------------------------------------------------------------------
# RRF 병합
# ---------------------------------------------------------------------------


def test_rrf_scores_sum_reciprocal_ranks_with_k60() -> None:
    merged = rrf_merge([[_r("a"), _r("b")], [_r("b"), _r("c")]])

    assert _names(merged) == ["b", "a", "c"]
    scores = {r.volume: r.score for r in merged}
    assert scores["b"] == pytest.approx(1 / 62 + 1 / 61)
    assert scores["a"] == pytest.approx(1 / 61)
    assert scores["c"] == pytest.approx(1 / 62)


def test_rrf_dedupes_by_volume_chunk_and_keeps_original_object() -> None:
    original = [_r("a", 0.9, source="M", matched_sources=("M",))]
    # 하위 질의 목록 안의 같은 chunk 중복은 첫 순위만 센다.
    sub = [_r("a", 0.1, source="U"), _r("a", 0.1), _r("b")]
    merged = rrf_merge([original, sub])

    assert _names(merged) == ["a", "b"]
    a = merged[0]
    assert a.score == pytest.approx(1 / 61 + 1 / 61)
    # 원 질의 쪽 객체의 필드를 그대로 둔다(score 만 RRF).
    assert a.source == "M" and a.matched_sources == ("M",)
    assert merged[1].score == pytest.approx(1 / 62)  # 중복을 빼고 2위
    # 다른 chunk_index 는 다른 chunk 다.
    same_volume = rrf_merge([[_r("a")], [SearchResult(text="x", volume="a", chunk_index=1, score=0.1)]])
    assert len(same_volume) == 2


def test_rrf_guarantees_top5_of_each_subquery_before_cap() -> None:
    originals = [_r(f"o{i}") for i in range(50)]
    # 원 질의 50건이 모두 두 목록에 걸쳐 나와 점수가 높다 → 보장이 없으면 u* 는 하나도 못 남는다.
    sub1 = originals[:30]
    sub2 = originals[20:]
    sub3 = [_r(f"u{i}") for i in range(30)]

    plain = rrf_merge([originals, sub1, sub2, sub3], guarantee=0)
    assert not any(n.startswith("u") for n in _names(plain))

    merged = rrf_merge([originals, sub1, sub2, sub3])
    names = _names(merged)
    assert len(merged) == 50
    assert {f"u{i}" for i in range(5)} <= set(names) and "u5" not in names
    for sub in (sub1, sub2, sub3):
        assert sum(1 for r in sub if r.volume in names) >= 5
    # 결과는 RRF 점수 내림차순이다(보장 항목은 뒤로 간다).
    assert [r.score for r in merged] == sorted((r.score for r in merged), reverse=True)


def test_rrf_caps_at_50() -> None:
    lists = [[_r(f"L{j}-{i}") for i in range(50 if j == 0 else 30)] for j in range(4)]
    merged = rrf_merge(lists)
    assert len(merged) == 50
    assert {f"L{j}-{i}" for j in (1, 2, 3) for i in range(5)} <= set(_names(merged))


def test_rrf_keeps_original_order_when_subqueries_add_nothing() -> None:
    originals = [_r(f"o{i}", score=1.0 - i * 0.01) for i in range(50)]
    assert _names(rrf_merge([originals, [], []])) == _names(originals)
    # 하위 질의가 원 질의 앞부분을 같은 순서로 되풀이해도 순서는 같다.
    assert _names(rrf_merge([originals, originals[:30], originals[:10]])) == _names(originals)


# ---------------------------------------------------------------------------
# planner
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_planner_ok_uses_json_mode_and_normalizes() -> None:
    gen = _planner_returns({"sub_queries": ["  참사랑의   뜻 ", "참가정의 의미"]})
    with patch.object(c2_decompose, "generate_text", gen):
        subs, status = await plan_sub_queries(QUERY, "conceptual")

    assert status == "ok" and subs == ["참사랑의 뜻", "참가정의 의미"]
    kwargs = gen.await_args.kwargs
    assert kwargs["response_schema"]["properties"]["sub_queries"]["max_items"] == 2
    assert kwargs["model"] == gemini.MODEL_GENERATE
    assert "질의 분해기" in kwargs["system_instruction"]


@pytest.mark.asyncio
@pytest.mark.parametrize(("intent", "limit"), [("conceptual", 2), ("reasoning", 3)])
async def test_planner_truncates_to_intent_limit(intent: str, limit: int) -> None:
    gen = _planner_returns({"sub_queries": ["가", "나", "다", "라"]})
    with patch.object(c2_decompose, "generate_text", gen):
        subs, status = await plan_sub_queries(QUERY, intent)
    assert status == "ok" and subs == ["가", "나", "다", "라"][:limit]


@pytest.mark.asyncio
async def test_planner_too_few_after_dedupe_against_original_and_each_other() -> None:
    gen = _planner_returns({"sub_queries": [f"  {QUERY} ", "참사랑의 뜻", "참사랑의  뜻", "", 3]})
    with patch.object(c2_decompose, "generate_text", gen):
        subs, status = await plan_sub_queries(QUERY, "reasoning")
    assert status == "too_few" and subs == ["참사랑의 뜻"]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["재작성된 질문", '["가", "나"]', '{"queries": ["가", "나"]}', ""])
async def test_planner_parse_fail(text: str) -> None:
    with patch.object(c2_decompose, "generate_text", _planner_returns(text)):
        subs, status = await plan_sub_queries(QUERY, "conceptual")
    assert (subs, status) == ([], "parse_fail")


@pytest.mark.asyncio
async def test_planner_timeout_and_error() -> None:
    async def slow(*args, **kwargs):
        await asyncio.sleep(1)
        return "{}"

    with (
        patch.object(c2_decompose, "PLANNER_TIMEOUT_S", 0.01),
        patch.object(c2_decompose, "generate_text", slow),
    ):
        assert await plan_sub_queries(QUERY, "conceptual") == ([], "timeout")
    with patch.object(c2_decompose, "generate_text", AsyncMock(side_effect=RuntimeError("429"))):
        assert await plan_sub_queries(QUERY, "conceptual") == ([], "error")


# ---------------------------------------------------------------------------
# decomposed_search
# ---------------------------------------------------------------------------


def _sub_search_mock(by_query: dict[str, list[SearchResult]]) -> AsyncMock:
    async def search(client, query, config, **kwargs):
        if isinstance(by_query.get(query), Exception):
            raise by_query[query]
        return by_query.get(query, [])

    return AsyncMock(side_effect=search)


@pytest.mark.asyncio
async def test_decomposed_search_merges_subqueries_and_records() -> None:
    originals = [_r(f"o{i}") for i in range(50)]
    stage = FakeSearchStage(originals)
    search = _sub_search_mock({"참사랑의 뜻": [_r("o3"), _r("s1")], "참가정의 의미": [_r("s2")]})
    planner = _planner_returns({"sub_queries": ["참사랑의 뜻", "참가정의 의미"]})
    ctx = _ctx()
    with (
        patch.object(c2_decompose, "generate_text", planner),
        patch.object(c2_decompose, "weighted_search", search),
        patch.object(c2_decompose, "get_raw_client", return_value="qdrant"),
    ):
        results, record = await decomposed_search(ctx, stage)

    assert stage.calls == 1
    names = _names(results)
    assert len(results) == 50 and names[0] == "o3"  # 두 목록에 걸친 chunk 가 1위
    assert {"s1", "s2"} <= set(names)
    # 하위 질의 검색은 같은 봇 설정·메타데이터·컬렉션으로 30건씩.
    for call in search.await_args_list:
        client, _query, config = call.args
        assert client == "qdrant" and isinstance(config, WeightedConfig)
        assert [(s.source, s.weight, s.score_threshold) for s in config.sources] == [
            ("M", 2.0, 0.1),
            ("U", 1.0, 0.2),
        ]
        assert call.kwargs == {"top_k": 30, "collection_name": "col", "query_metadata": {"volume": 3}}
    assert ctx.request.query == QUERY  # rerank 는 원 질문으로 한다
    assert record["planner_status"] == "ok" and record["fallback"] is False
    assert record["sub_queries"] == ["참사랑의 뜻", "참가정의 의미"]
    assert record["sub_counts"] == [2, 1]
    assert record["n_original"] == 50 and record["n_merged"] == 50
    assert record["n_from_subqueries_only"] == 2
    assert record["planner_ms"] >= 0 and record["total_ms"] >= record["planner_ms"]
    assert record["llm"] is None  # 수집기 없음


@pytest.mark.asyncio
async def test_planner_runs_in_parallel_with_original_search() -> None:
    search_started, planner_started = asyncio.Event(), asyncio.Event()

    async def before_search():
        search_started.set()
        await planner_started.wait()

    async def planner(*args, **kwargs):
        planner_started.set()
        await search_started.wait()
        return json.dumps({"sub_queries": ["가", "나"]})

    stage = FakeSearchStage([_r("o0")], before=before_search)
    with (
        patch.object(c2_decompose, "generate_text", planner),
        patch.object(c2_decompose, "weighted_search", _sub_search_mock({})),
        patch.object(c2_decompose, "get_raw_client"),
    ):
        # 순서대로 돌면 서로를 기다리다 멈춘다.
        results, record = await asyncio.wait_for(decomposed_search(_ctx(), stage), timeout=1.0)
    assert record["planner_status"] == "ok" and _names(results) == ["o0"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("planner", "status"),
    [
        (AsyncMock(side_effect=TimeoutError()), "timeout"),
        (_planner_returns("not json"), "parse_fail"),
        (_planner_returns({"sub_queries": ["참사랑의 뜻"]}), "too_few"),
    ],
)
async def test_fallback_returns_original_results_without_subsearch(planner, status) -> None:
    originals = [_r(f"o{i}", score=0.3) for i in range(50)]
    stage = FakeSearchStage(originals)
    search = _sub_search_mock({})
    ctx = _ctx("reasoning")
    with (
        patch.object(c2_decompose, "generate_text", planner),
        patch.object(c2_decompose, "weighted_search", search),
    ):
        results, record = await decomposed_search(ctx, stage)

    assert stage.calls == 1  # 원 질의 검색은 한 번뿐
    search.assert_not_awaited()
    assert results == originals  # 점수도 현행 그대로
    assert record["fallback"] is True and record["planner_status"] == status
    assert "n_merged" not in record


@pytest.mark.asyncio
async def test_not_applicable_returns_none_without_work() -> None:
    stage = FakeSearchStage([_r("o0")])
    gen = _planner_returns({"sub_queries": ["가", "나"]})
    with patch.object(c2_decompose, "generate_text", gen):
        assert await decomposed_search(_ctx("factoid"), stage) is None
        no_config = _ctx()
        no_config.runtime_config = None
        assert await decomposed_search(no_config, stage) is None
    assert stage.calls == 0
    gen.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_subquery_is_isolated() -> None:
    stage = FakeSearchStage([_r("o0")])
    search = _sub_search_mock({"가": RuntimeError("boom"), "나": [_r("s1")]})
    with (
        patch.object(c2_decompose, "generate_text", _planner_returns({"sub_queries": ["가", "나"]})),
        patch.object(c2_decompose, "weighted_search", search),
        patch.object(c2_decompose, "get_raw_client"),
    ):
        results, record = await decomposed_search(_ctx(), stage)
    assert _names(results) == ["o0", "s1"]
    assert record["sub_counts"] == [0, 1]


@pytest.mark.asyncio
async def test_trace_keeps_original_search_records_and_planner_usage() -> None:
    """하위 질의 검색은 수집기를 끄고 돌며, span 1개씩과 planner 토큰만 남긴다."""

    class _Usage:
        prompt_token_count = 11
        candidates_token_count = 7

    async def generate_content(model, contents, config):
        return SimpleNamespace(
            text=json.dumps({"sub_queries": ["가", "나"]}), usage_metadata=_Usage()
        )

    seen_trace: list[object] = []

    async def search(client, query, config, **kwargs):
        seen_trace.append(current_trace.get())
        return [_r(f"s-{query}")]

    fake_client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
    )
    collector = TraceCollector()
    token = current_trace.set(collector)
    try:
        with (
            patch.object(gemini, "_client", fake_client),
            patch.object(c2_decompose, "weighted_search", AsyncMock(side_effect=search)),
            patch.object(c2_decompose, "get_raw_client"),
        ):
            _results, record = await decomposed_search(_ctx(), FakeSearchStage([_r("o0")]))
    finally:
        current_trace.reset(token)

    assert seen_trace == [None, None]
    assert collector.tiers == [] and collector.hybrid_calls == [] and collector.merged is None
    subs = [s for s in collector.spans if s.name == "c2.sub_search"]
    assert [s.input["query"] for s in subs] == ["가", "나"]
    assert [s.output["n_results"] for s in subs] == [1, 1]
    llm_span = next(s for s in collector.spans if s.name == "gemini.generate_text")
    assert llm_span.parent == "c2.plan"
    assert record["llm"] == {"model": gemini.MODEL_GENERATE, "input_tokens": 11, "output_tokens": 7}
