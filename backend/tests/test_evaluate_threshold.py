"""evaluate_threshold metric 함수 + run_search 통합 단위 테스트 (Phase 0).

metric 함수의 수학적 정확성, 골든셋 로더의 라벨 검증, 그리고 PR 2 에서
활성화된 run_search 의 cascading_search + reranker dispatch 동작을 검증한다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# scripts/ 는 패키지가 아니므로 sys.path 조작
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from evaluate_threshold import (  # noqa: E402
    diff_runs,
    evaluate_set,
    is_labeled,
    load_golden,
    mrr_at_k,
    ndcg_at_k,
    recall_at_k,
    run_search,
)
from src.search.hybrid import SearchResult  # noqa: E402


# ── recall_at_k ─────────────────────────────────────────────────────────────


def test_recall_at_k_full_match():
    assert recall_at_k({"a", "b"}, ["a", "b", "c"], 10) == 1.0


def test_recall_at_k_partial():
    assert recall_at_k({"a", "b"}, ["a", "x", "y"], 10) == 0.5


def test_recall_at_k_no_match():
    assert recall_at_k({"a", "b"}, ["x", "y"], 10) == 0.0


def test_recall_at_k_empty_expected():
    assert recall_at_k(set(), ["a", "b"], 10) == 0.0


def test_recall_at_k_truncates_to_k():
    assert recall_at_k({"c"}, ["a", "b", "c"], 2) == 0.0


# ── mrr_at_k ─────────────────────────────────────────────────────────────


def test_mrr_at_k_first_position():
    assert mrr_at_k({"a"}, ["a", "b"], 10) == 1.0


def test_mrr_at_k_third_position():
    assert mrr_at_k({"a"}, ["x", "y", "a"], 10) == 1.0 / 3


def test_mrr_at_k_no_match():
    assert mrr_at_k({"a"}, ["x", "y"], 10) == 0.0


def test_mrr_at_k_returns_first_hit_only():
    """여러 정답 중 첫 번째 hit 의 역순위만 반환."""
    assert mrr_at_k({"a", "b"}, ["x", "b", "a"], 10) == 1.0 / 2


# ── ndcg_at_k ─────────────────────────────────────────────────────────────


def test_ndcg_at_k_perfect_single():
    assert ndcg_at_k({"a"}, ["a"], 10) == 1.0


def test_ndcg_at_k_no_match():
    assert ndcg_at_k({"a"}, ["x", "y"], 10) == 0.0


def test_ndcg_at_k_empty_expected():
    assert ndcg_at_k(set(), ["a"], 10) == 0.0


def test_ndcg_at_k_two_correct_ordered():
    """정답 둘이 1, 2위면 NDCG = 1.0 (perfect)."""
    assert ndcg_at_k({"a", "b"}, ["a", "b", "c"], 10) == 1.0


def test_ndcg_at_k_two_correct_swapped_with_distractor():
    """정답 둘이 1, 3위 → NDCG < 1."""
    score = ndcg_at_k({"a", "b"}, ["a", "x", "b"], 10)
    assert 0.0 < score < 1.0


# ── golden set loader ─────────────────────────────────────────────────────


def test_load_golden_returns_dict(tmp_path):
    p = tmp_path / "g.json"
    p.write_text(
        json.dumps({"version": 1, "queries": [{"id": "q1"}]}), encoding="utf-8"
    )
    data = load_golden(p)
    assert data["version"] == 1
    assert data["queries"][0]["id"] == "q1"


def test_is_labeled_false_when_both_empty():
    assert is_labeled({"expected_chunk_ids": [], "expected_volumes": []}) is False


def test_is_labeled_true_with_chunks():
    assert is_labeled({"expected_chunk_ids": ["001:1"], "expected_volumes": []}) is True


def test_is_labeled_true_with_volumes_only():
    assert is_labeled({"expected_chunk_ids": [], "expected_volumes": ["003"]}) is True


# ── diff_runs ─────────────────────────────────────────────────────────────


def test_diff_runs_computes_delta():
    baseline = {"n_evaluated": 5, "macro": {"recall@10": 0.5, "mrr@10": 0.4, "ndcg@10": 0.6}}
    after = {"n_evaluated": 5, "macro": {"recall@10": 0.7, "mrr@10": 0.5, "ndcg@10": 0.65}}
    out = diff_runs(baseline, after)
    assert out["diff"]["recall@10"]["delta"] == 0.7 - 0.5
    assert out["diff"]["mrr@10"]["delta"] == 0.5 - 0.4


def test_diff_runs_handles_none():
    """모두 라벨 미작성으로 macro 가 None 일 때 delta = None."""
    baseline = {"n_evaluated": 0, "macro": {"recall@10": None}}
    after = {"n_evaluated": 0, "macro": {"recall@10": None}}
    out = diff_runs(baseline, after)
    assert out["diff"]["recall@10"]["delta"] is None


# ── run_search ─────────────────────────────────────────────────────────────


def _fake_search_results() -> list[SearchResult]:
    return [
        SearchResult(text="t1", volume="vol_001", chunk_index=0, score=0.9, source="A"),
        SearchResult(text="t2", volume="vol_002", chunk_index=1, score=0.7, source="B"),
    ]


@pytest.mark.asyncio
async def test_run_search_default_uses_gemini_reranker():
    """rerank_model='gemini-flash' (default) → cascading_search + reranker.rerank 모두 호출."""
    fake_results = _fake_search_results()
    fake_reranked = [
        SearchResult(
            text="t1", volume="vol_001", chunk_index=0, score=0.9, source="A", rerank_score=0.95,
        )
    ]
    mock_rerank = AsyncMock(return_value=fake_reranked)

    with (
        patch("src.qdrant_client.get_raw_client", return_value=MagicMock()),
        patch(
            "src.search.cascading.cascading_search",
            new_callable=AsyncMock, return_value=fake_results,
        ) as mock_cascade,
        patch("src.search.reranker.rerank", new=mock_rerank),
    ):
        out = await run_search("q", top_k=10, rerank_model="gemini-flash")

    mock_cascade.assert_awaited_once()
    # cascading top_k 는 max(top_k*2, 20) — PR 7 에서 Gemini JSON 안정성 위해 50→20 축소
    assert mock_cascade.await_args.kwargs.get("top_k", 0) >= 20
    mock_rerank.assert_awaited_once()
    assert out == [
        {"volume": "vol_001", "chunk_index": 0, "score": 0.9, "rerank_score": 0.95},
    ]


@pytest.mark.asyncio
async def test_run_search_none_skips_reranker():
    """rerank_model='none' → reranker 호출 없이 cascading 결과 그대로 top_k 자름."""
    fake_results = _fake_search_results()

    with (
        patch("src.qdrant_client.get_raw_client", return_value=MagicMock()),
        patch(
            "src.search.cascading.cascading_search",
            new_callable=AsyncMock, return_value=fake_results,
        ),
        patch("src.search.reranker.rerank") as mock_get_reranker,
    ):
        out = await run_search("q", top_k=1, rerank_model="none")

    mock_get_reranker.assert_not_called()
    assert len(out) == 1
    assert out[0]["volume"] == "vol_001"
    assert out[0]["rerank_score"] is None


@pytest.mark.asyncio
async def test_run_search_empty_results_skips_reranker():
    """cascading 결과 0건 → reranker 호출 안 함, 빈 리스트 반환."""
    with (
        patch("src.qdrant_client.get_raw_client", return_value=MagicMock()),
        patch(
            "src.search.cascading.cascading_search",
            new_callable=AsyncMock, return_value=[],
        ),
        patch("src.search.reranker.rerank") as mock_get_reranker,
    ):
        out = await run_search("q", top_k=10, rerank_model="gemini-flash")

    mock_get_reranker.assert_not_called()
    assert out == []


@pytest.mark.asyncio
async def test_evaluate_set_skips_unlabeled_queries_without_calling_search(tmp_path):
    """마스터 plan 검증 시나리오: 라벨 없는 쿼리만 있으면 run_search 호출 0회, n_evaluated=0."""
    golden = tmp_path / "g.json"
    golden.write_text(
        json.dumps({
            "version": 1,
            "queries": [
                {"id": "q1", "query": "축복?", "expected_chunk_ids": [], "expected_volumes": []},
                {"id": "q2", "query": "효정?", "expected_chunk_ids": [], "expected_volumes": []},
            ],
        }),
        encoding="utf-8",
    )

    with patch("evaluate_threshold.run_search", new_callable=AsyncMock) as mock_search:
        out = await evaluate_set(golden, rerank_model="gemini-flash")

    mock_search.assert_not_awaited()
    assert out["n_evaluated"] == 0
    assert out["n_skipped_no_label"] == 2
    assert out["rerank_model"] == "gemini-flash"
    assert out["chatbot_id"] is None
