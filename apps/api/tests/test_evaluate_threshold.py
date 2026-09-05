"""evaluate_threshold metric 함수 단위 테스트 (Phase 0).

run_search 는 staging 환경 의존이라 stub. 본 테스트는 metric 함수의
수학적 정확성과 골든셋 로더의 라벨 검증 로직만 검증한다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# scripts/ 는 패키지가 아니므로 sys.path 조작
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from evaluate_threshold import (  # noqa: E402
    diff_runs,
    is_labeled,
    load_golden,
    mrr_at_k,
    ndcg_at_k,
    recall_at_k,
)


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
