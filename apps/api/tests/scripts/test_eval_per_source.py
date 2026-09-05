"""eval_per_source 단위 테스트.

목적: 시드 50건을 gold_source로 분할 → 각 source별 4메트릭 평균 산출.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.eval_per_source import (
    compute_source_metric_matrix,
    group_seed_by_source,
)


def _write_seed(path: Path, rows: list[dict]) -> None:
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")


def test_group_seed_by_source_buckets_correctly(tmp_path: Path) -> None:
    seed = tmp_path / "seed.json"
    _write_seed(seed, [
        {"id": 1, "gold_source": "B", "question": "q1", "ground_truth": "g1", "contexts": ["c1"]},
        {"id": 2, "gold_source": "L", "question": "q2", "ground_truth": "g2", "contexts": ["c2"]},
        {"id": 3, "gold_source": "B", "question": "q3", "ground_truth": "g3", "contexts": ["c3"]},
    ])
    grouped = group_seed_by_source(seed)
    assert set(grouped.keys()) == {"B", "L"}
    assert len(grouped["B"]) == 2
    assert len(grouped["L"]) == 1


def test_compute_source_metric_matrix_returns_per_source_averages() -> None:
    per_source_results = {
        "B": [
            {"faithfulness": 0.6, "context_precision": 0.7, "context_recall": 0.5, "answer_relevancy": 0.8},
            {"faithfulness": 0.4, "context_precision": 0.5, "context_recall": 0.3, "answer_relevancy": 0.6},
        ],
        "L": [
            {"faithfulness": 0.8, "context_precision": 0.9, "context_recall": 0.7, "answer_relevancy": 0.9},
        ],
    }
    matrix = compute_source_metric_matrix(per_source_results)
    rows = {r["source"]: r for r in matrix}
    assert rows["B"]["n"] == 2
    assert rows["B"]["faithfulness"] == pytest.approx(0.5)
    assert rows["L"]["n"] == 1
    assert rows["L"]["faithfulness"] == pytest.approx(0.8)


def test_compute_matrix_handles_empty_source() -> None:
    assert compute_source_metric_matrix({}) == []
