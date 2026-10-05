"""rag-trace 후보 표 — drop_stage 판정과 RRF 자기검증 (Qdrant·Gemini 없음)."""

from __future__ import annotations

import pytest

from app.modules.chat.trace import HybridCall, RerankRecord, TierRecord, TraceCollector
from app.modules.chat.trace_service import (
    DebugLookup,
    _tier_views,
    build_candidates,
    classify_drop,
    count_rrf_mismatches,
    rrf_expected,
)
from app.modules.search.hybrid import SearchResult


def _sr(cid: str, score: float, source: str = "A") -> SearchResult:
    return SearchResult(
        text=f"본문 {cid}", volume=f"vol-{cid}", chunk_index=int(cid[1:]), score=score,
        source=source, chunk_id=cid,
    )


def _payload(cid: str, tags: list[str]) -> dict:
    return {"volume": f"vol-{cid}", "chunk_index": int(cid[1:]), "source": tags, "text": f"본문 {cid}"}


_FILTER_A = {"must": [{"key": "source", "match": {"any": ["A"]}}]}


def _cascading_scenario() -> tuple[TraceCollector, DebugLookup, list[SearchResult], list[SearchResult]]:
    """tier0(A) 만 실행되고 tier1(B) 은 도달하지 않은 cascading 1건.

    k1..k5 qualified → 병합 top_k=4 (k5 merge_cut), k6 threshold 미달,
    k7 필터 조회엔 있으나 fused 밖, k8 은 미도달 tier1 의 source(B),
    k9 는 필터(source C) 에 걸림. rerank top_k=3, context slice=2.
    """
    c = TraceCollector()
    c.tier_plan = [(["A"], 2), (["B"], 2)]
    fused = [_sr("k1", 0.5), _sr("k2", 0.45), _sr("k3", 0.4), _sr("k4", 0.3), _sr("k5", 0.2), _sr("k6", 0.05)]
    c.record_hybrid(
        HybridCall(
            collection="col", source_filter=["A"], query_filter=_FILTER_A, prefetch_limit=50,
            dense=[0.1], sparse=([1], [1.0]), results=fused,
        ),
        c.t0,
    )
    c.record_tier(TierRecord(mode="cascading", tier_idx=0, sources=["A"], threshold=0.1,
                             results=fused, min_results=2, stopped_here=True))
    merged = fused[:5]
    c.record_merge(merged, 4)
    search_output = merged[:4]
    rerank_out = [search_output[1], search_output[0], search_output[2]]
    c.record_rerank(RerankRecord("q", list(search_output), [0.8, 0.9, 0.5, 0.1], "ok", 3))

    debug = DebugLookup(
        unfiltered_dense=["k1", "k8", "k9"],
        unfiltered_sparse=["k1"],
        per_call={0: (["k1", "k2", "k7"], ["k3", "k4", "k1"])},
        payloads={
            "k7": _payload("k7", ["A"]),
            "k8": _payload("k8", ["B"]),
            "k9": _payload("k9", ["C"]),
        },
    )
    return c, debug, search_output, rerank_out


def test_drop_stage_cascading_covers_each_stage() -> None:
    c, debug, search_output, rerank_out = _cascading_scenario()
    rows, warnings = build_candidates(
        c, debug, search_output=search_output, rerank_output=rerank_out, context_slice=2
    )
    by_id = {r.chunk_id: r for r in rows}
    assert {cid: r.drop_stage for cid, r in by_id.items()} == {
        "k2": "kept",
        "k1": "kept",
        "k3": "context_cut",
        "k4": "rerank_cut",
        "k5": "merge_cut",
        "k6": "below_threshold",
        "k7": "fusion_cut",
        "k8": "tier_not_reached",
        "k9": "filtered",
    }
    # 순위·점수 칸
    k1 = by_id["k1"]
    assert (k1.dense_rank, k1.sparse_rank, k1.fused_rank) == (1, 3, 1)
    assert k1.rerank_rank == 2 and k1.context_rank == 2 and k1.cited_rank == 2
    assert k1.rerank_score == pytest.approx(0.8)
    assert by_id["k3"].context_rank is None and by_id["k3"].cited_rank == 3
    assert by_id["k6"].qualified is False and by_id["k1"].qualified is True
    assert by_id["k8"].tier_idx is None and by_id["k8"].source == "B"
    assert k1.key == "vol-k1:1"
    assert "filter_loss:1" in warnings


def test_drop_stage_not_retrieved_when_absent_everywhere() -> None:
    # v0 후보 표는 어떤 목록에든 있는 문서만 행으로 만든다. 판정 함수로 마지막 분기를 확인한다.
    assert (
        classify_drop(
            rerank_ran=True, in_rerank_output=False, in_context=False, in_search_output=False,
            in_merged=False, in_fused=False, in_filtered=False, in_unreached_tier=False,
            in_unfiltered=False,
        )
        == "not_retrieved"
    )


def test_drop_stage_without_rerank_stage_marks_search_output_kept() -> None:
    c, debug, search_output, _ = _cascading_scenario()
    c.rerank = None
    rows, _ = build_candidates(c, debug, search_output=search_output, rerank_output=None, context_slice=None)
    by_id = {r.chunk_id: r for r in rows}
    assert {by_id[k].drop_stage for k in ("k1", "k2", "k3", "k4")} == {"kept"}
    assert by_id["k1"].rerank_rank is None and by_id["k1"].context_rank is None


def test_drop_stage_fallback_relaxed_when_all_tiers_empty() -> None:
    c = TraceCollector()
    c.tier_plan = [(["A"], 3)]
    below = [_sr("k1", 0.05)]
    c.record_hybrid(
        HybridCall(collection="col", source_filter=["A"], query_filter=_FILTER_A, prefetch_limit=50,
                   dense=[0.1], sparse=([1], [1.0]), results=below),
        c.t0,
    )
    c.record_tier(TierRecord(mode="cascading", tier_idx=0, sources=["A"], threshold=0.1,
                             results=below, min_results=3))
    c.record_merge([], 50)
    relaxed = [_sr("f1", 0.3, "B"), _sr("f2", 0.01, "C")]
    c.record_fallback(collection="col", dense=[0.1], sparse=([1], [1.0]), results=relaxed, threshold=0.05)
    search_output = relaxed[:1]
    debug = DebugLookup(
        unfiltered_dense=["f1", "k1"], unfiltered_sparse=["f2"],
        per_call={0: (["k1"], [])},
    )

    rows, _ = build_candidates(c, debug, search_output=search_output, rerank_output=list(search_output), context_slice=6)
    by_id = {r.chunk_id: r for r in rows}
    assert by_id["f1"].origin == "fallback_relaxed" and by_id["f1"].drop_stage == "kept"
    assert by_id["f2"].origin == "fallback_relaxed" and by_id["f2"].drop_stage == "below_threshold"
    assert by_id["k1"].origin == "hybrid" and by_id["k1"].drop_stage == "below_threshold"
    assert by_id["f1"].tier_idx == 1  # 실행한 tier 다음 번호


def test_duplicate_chunk_across_tiers_gets_duplicate_row() -> None:
    c = TraceCollector()
    t0 = [_sr("k1", 0.5)]
    t1 = [_sr("k1", 0.4), _sr("k2", 0.3)]
    for idx, (sources, res) in enumerate(((["A"], t0), (["A", "B"], t1))):
        c.record_hybrid(
            HybridCall(collection="col", source_filter=sources, query_filter={"must": []},
                       prefetch_limit=50, dense=[0.1], sparse=([1], [1.0]), results=res),
            c.t0,
        )
        c.record_tier(TierRecord(mode="cascading", tier_idx=idx, sources=sources, threshold=0.1,
                                 results=res, min_results=3))
    merged = [t0[0], t1[0], t1[1]]
    c.record_merge(merged, 50)

    rows, warnings = build_candidates(c, None, search_output=merged, rerank_output=None, context_slice=None)
    k1_rows = [r for r in rows if r.chunk_id == "k1"]
    assert len(k1_rows) == 2
    assert k1_rows[0].duplicate_of is None and k1_rows[1].duplicate_of == k1_rows[0].key
    assert (k1_rows[0].tier_idx, k1_rows[1].tier_idx) == (0, 1)
    assert "duplicates:1" in warnings


def test_rrf_expected_matches_qdrant_formula() -> None:
    # Qdrant RRF = Σ 1/(2 + rank0). 1위는 0.5, 한쪽 리스트 9위(rank0=8)가 cutoff 0.1.
    assert rrf_expected(1, None) == pytest.approx(0.5)
    assert rrf_expected(1, 3) == pytest.approx(0.5 + 0.25)
    assert rrf_expected(9, None) == pytest.approx(0.1)
    assert rrf_expected(None, None) == 0.0


def test_rrf_self_check_counts_mismatch_between_debug_ranks_and_fused() -> None:
    """디버그 조회(같은 필터) 순위로 다시 계산한 RRF 가 운영 fused 점수와 같아야 한다."""
    c = TraceCollector()
    dense, sparse = ["k1", "k2", "k3"], ["k3", "k1"]
    fused = [
        _sr("k1", rrf_expected(1, 2)),
        _sr("k3", rrf_expected(3, 1)),
        _sr("k2", rrf_expected(2, None)),
    ]
    c.record_hybrid(
        HybridCall(collection="col", source_filter=["A"], query_filter=_FILTER_A, prefetch_limit=50,
                   dense=[0.1], sparse=([1], [1.0]), results=fused),
        c.t0,
    )
    c.record_tier(TierRecord(mode="cascading", tier_idx=0, sources=["A"], threshold=0.1, results=fused))
    debug = DebugLookup(per_call={0: (dense, sparse)})
    assert count_rrf_mismatches(_tier_views(c, debug)) == 0

    # 필터가 prefetch 에 전파되지 않았다면 fused 점수는 다른 순위에서 나온다 → 불일치로 드러난다.
    fused[2].score = rrf_expected(1, None)
    assert count_rrf_mismatches(_tier_views(c, debug)) == 1
    _, warnings = build_candidates(c, debug, search_output=fused, rerank_output=None, context_slice=None)
    assert "rrf_mismatch:1" in warnings
