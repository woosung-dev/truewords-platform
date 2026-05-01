"""compare_rerankers 단위 테스트 (PR 7).

evaluate_set / run_search 를 mock 하여 latency 측정, 카테고리 집계,
markdown 렌더링을 검증.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from scripts.compare_rerankers import (
    _compute_latency_stats,
    evaluate_one_model,
    render_markdown,
    run_all,
)


def _evaluate_set_result(model: str, base: float = 0.5) -> dict:
    """Mock evaluate_set 응답."""
    return {
        "n_queries_total": 60,
        "n_evaluated": 54,
        "n_skipped_no_label": 6,
        "rerank_model": model,
        "macro": {"recall@10": base + 0.1, "mrr@10": base, "ndcg@10": base + 0.05},
        "per_query": [
            {"id": "f01", "category": "factoid",
             "metrics": {"recall@10": base + 0.2, "mrr@10": base + 0.1, "ndcg@10": base + 0.15}},
            {"id": "c01", "category": "conceptual",
             "metrics": {"recall@10": base, "mrr@10": base - 0.1, "ndcg@10": base - 0.05}},
            {"id": "r01", "category": "reasoning",
             "metrics": {"recall@10": base + 0.05, "mrr@10": base, "ndcg@10": base + 0.025}},
        ],
    }


def _write_golden(path: Path) -> None:
    payload = {
        "version": 4,
        "queries": [
            {"id": "f01", "category": "factoid", "query": "q1",
             "expected_chunk_ids": ["v:1"], "expected_volumes": []},
            {"id": "c01", "category": "conceptual", "query": "q2",
             "expected_chunk_ids": ["v:2"], "expected_volumes": []},
            {"id": "r01", "category": "reasoning", "query": "q3",
             "expected_chunk_ids": ["v:3"], "expected_volumes": []},
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


# ── _compute_latency_stats ─────────────────────────────────────────────────


def test_compute_latency_stats_with_samples():
    out = _compute_latency_stats(
        latencies=[100.0, 200.0, 300.0, 400.0, 500.0], first_call_ms=1000.0,
    )
    assert out["first_call"] == 1000.0
    # n=5, p50 = sorted[2] = 300, p95 = sorted[min(4, 4)] = 500
    assert out["p50"] == 300.0
    assert out["p95"] == 500.0
    assert out["n_samples"] == 5


def test_compute_latency_stats_empty():
    out = _compute_latency_stats(latencies=[], first_call_ms=None)
    assert out["p50"] is None
    assert out["n_samples"] == 0


def test_compute_latency_stats_with_first_call_only():
    out = _compute_latency_stats(latencies=[], first_call_ms=999.0)
    assert out["first_call"] == 999.0
    assert out["p50"] is None


# ── evaluate_one_model ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_evaluate_one_model_calls_evaluate_set_per_run(tmp_path):
    golden = tmp_path / "golden.json"
    _write_golden(golden)

    with patch(
        "scripts.evaluate_threshold.evaluate_set",
        new=AsyncMock(return_value=_evaluate_set_result("mock-base", base=0.6)),
    ) as mock_eval, patch(
        "scripts.evaluate_threshold.run_search",
        new=AsyncMock(return_value=[]),
    ) as mock_run:
        out = await evaluate_one_model(
            model="mock-base",
            runs=3,
            golden_path=golden,
            chatbot_id=None,
            collection_name="test_coll",
            sources=["U"],
            top_k=10,
        )

    # evaluate_set N runs 호출
    assert mock_eval.call_count == 3
    # run_search 는 N runs × 3 labeled queries = 9 호출 (latency 측정용)
    assert mock_run.call_count == 9
    assert out["model"] == "mock-base"
    assert out["runs"] == 3
    assert out["macro"]["ndcg@10"] == pytest.approx(0.65)


@pytest.mark.asyncio
async def test_evaluate_one_model_aggregates_categories(tmp_path):
    golden = tmp_path / "golden.json"
    _write_golden(golden)
    with patch(
        "scripts.evaluate_threshold.evaluate_set",
        new=AsyncMock(return_value=_evaluate_set_result("gemini-flash", base=0.5)),
    ), patch(
        "scripts.evaluate_threshold.run_search",
        new=AsyncMock(return_value=[]),
    ):
        out = await evaluate_one_model(
            model="gemini-flash",
            runs=1,
            golden_path=golden,
            chatbot_id=None,
            collection_name=None,
            sources=["U"],
            top_k=10,
        )
    by_cat = out["by_category"]
    assert "factoid" in by_cat
    assert "conceptual" in by_cat
    assert "reasoning" in by_cat
    # factoid 의 mock 값: ndcg=0.65
    assert by_cat["factoid"]["ndcg@10"] == pytest.approx(0.65)


@pytest.mark.asyncio
async def test_evaluate_one_model_first_call_separated(tmp_path):
    """first_call_ms 가 별도로 기록되고 p50 latencies 에서 제외."""
    golden = tmp_path / "golden.json"
    _write_golden(golden)
    with patch(
        "scripts.evaluate_threshold.evaluate_set",
        new=AsyncMock(return_value=_evaluate_set_result("mock-ko", base=0.7)),
    ), patch(
        "scripts.evaluate_threshold.run_search",
        new=AsyncMock(return_value=[]),
    ):
        out = await evaluate_one_model(
            model="mock-ko",
            runs=1,
            golden_path=golden,
            chatbot_id=None,
            collection_name=None,
            sources=["U"],
            top_k=10,
        )
    # 3 labeled queries × 1 run = 3 calls. 1번째 = first_call, 나머지 2 = p50/p95 source.
    assert out["latency_ms"]["first_call"] is not None
    assert out["latency_ms"]["n_samples"] == 2


# ── run_all ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_all_returns_config_and_results(tmp_path):
    golden = tmp_path / "golden.json"
    _write_golden(golden)
    with patch(
        "scripts.evaluate_threshold.evaluate_set",
        new=AsyncMock(return_value=_evaluate_set_result("gemini-flash", base=0.5)),
    ), patch(
        "scripts.evaluate_threshold.run_search",
        new=AsyncMock(return_value=[]),
    ):
        report = await run_all(
            models=["gemini-flash", "mock-base"],
            runs=1,
            golden_path=golden,
            chatbot_id=None,
            collection_name="test",
            sources=["U"],
            top_k=10,
        )
    assert "config" in report
    assert "results" in report
    assert set(report["results"].keys()) == {"gemini-flash", "mock-base"}
    assert report["config"]["models"] == ["gemini-flash", "mock-base"]
    assert report["config"]["runs"] == 1
    assert report["config"]["n_queries_labeled"] == 3


# ── render_markdown ─────────────────────────────────────────────────────────


def test_render_markdown_includes_winner_bold():
    report = {
        "config": {
            "ts": "2026-05-01T10:00:00",
            "models": ["gemini-flash", "mock-ko"],
            "runs": 3,
            "collection": "malssum_poc_v5",
            "chatbot_id": "신학/원리 전문 봇",
            "sources": ["U"],
            "n_queries_labeled": 54,
            "n_queries_total": 60,
        },
        "results": {
            "gemini-flash": {
                "model": "gemini-flash",
                "macro": {"ndcg@10": 0.50, "mrr@10": 0.45, "recall@10": 0.65},
                "by_category": {
                    "factoid": {"ndcg@10": 0.55, "mrr@10": 0.50, "recall@10": 0.7},
                    "conceptual": {"ndcg@10": 0.45, "mrr@10": 0.40, "recall@10": 0.6},
                    "reasoning": {"ndcg@10": 0.35, "mrr@10": 0.30, "recall@10": 0.5},
                },
                "latency_ms": {"first_call": 3000, "p50": 2500, "p95": 4000, "p99": 5000},
            },
            "mock-ko": {
                "model": "mock-ko",
                "macro": {"ndcg@10": 0.60, "mrr@10": 0.50, "recall@10": 0.70},
                "by_category": {
                    "factoid": {"ndcg@10": 0.65, "mrr@10": 0.55, "recall@10": 0.75},
                    "conceptual": {"ndcg@10": 0.55, "mrr@10": 0.45, "recall@10": 0.65},
                    "reasoning": {"ndcg@10": 0.50, "mrr@10": 0.40, "recall@10": 0.55},
                },
                "latency_ms": {"first_call": 30000, "p50": 4500, "p95": 6000, "p99": 7000},
            },
        },
    }
    md = render_markdown(report)
    # winner 인 mock-ko 는 NDCG/MRR/Recall 에서 bold
    assert "**0.6000**" in md  # mock-ko NDCG
    assert "`mock-ko`" in md
    assert "factoid" in md
    assert "conceptual" in md
    assert "reasoning" in md
    # gemini-flash NDCG 는 winner 가 아니므로 bold X
    assert "**0.5000**" not in md or md.count("**0.5000**") <= 1
