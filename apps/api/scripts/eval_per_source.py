"""Source-weight ablation 평가 (옵션 G).

시드 50건을 RAGAS 4메트릭으로 한 번에 평가한 뒤 gold_source 컬럼으로 그룹핑해
source × metric 평균 매트릭스를 산출. 약점 source 식별이 목적.

사용 예:
    PYTHONPATH=. uv run python scripts/eval_per_source.py \\
        --seed ~/Downloads/ragas_eval_seed_50_with_source_label.json \\
        --output ~/Downloads/per_source_ablation_20260428.xlsx
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from openpyxl import Workbook

from scripts.eval_ragas import SeedItem, load_seed, run_evaluation


METRICS = ("faithfulness", "context_precision", "context_recall", "answer_relevancy")


def run_evaluation_in_batches(
    items: list[SeedItem], batch_size: int = 5
) -> dict[str, list[float | None]]:
    """RAGAS 평가를 batch_size 단위 직렬로 호출.

    이유: RAGAS 0.4.3 + langchain-google-genai 4.2.2에서 50건 한 번 호출 시
    Job multiplexing이 timeout으로 90% 이상 실패. 5건 sanity는 timeout 0이므로
    items를 batch_size 단위로 chunk해서 직렬 evaluate → 결과를 원본 순서대로 합침.
    """
    accumulated: dict[str, list[float | None]] = {m: [] for m in METRICS}
    n = len(items)
    for start in range(0, n, batch_size):
        chunk = items[start : start + batch_size]
        print(f"  batch {start // batch_size + 1}/{(n + batch_size - 1) // batch_size} (items {start + 1}~{start + len(chunk)})")
        scores = run_evaluation(chunk)
        for m in METRICS:
            accumulated[m].extend(scores.get(m, [None] * len(chunk)))
    return accumulated


def group_seed_by_source(seed_path: Path) -> dict[str, list[dict]]:
    """시드 JSON을 gold_source별로 그룹핑."""
    rows = json.loads(seed_path.read_text(encoding="utf-8"))
    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        grouped[str(r.get("gold_source", "Unknown"))].append(r)
    return dict(grouped)


def compute_source_metric_matrix(
    per_source_results: dict[str, list[dict]],
) -> list[dict]:
    """source별 4메트릭 평균 매트릭스. None은 평균에서 제외."""
    if not per_source_results:
        return []
    out: list[dict] = []
    for src in sorted(per_source_results):
        rows = per_source_results[src]
        n = len(rows)
        avg: dict[str, float] = {}
        for m in METRICS:
            vals: list[float] = [float(r[m]) for r in rows if r.get(m) is not None]
            avg[m] = sum(vals) / len(vals) if vals else 0.0
        out.append({"source": src, "n": n, **avg})
    return out


def _build_per_source_results(
    seed_rows: list[dict],
    scores: dict[str, list[float | None]],
) -> dict[str, list[dict]]:
    """run_evaluation 결과(scores)를 시드 행 순서대로 풀어 source별 dict 리스트로 변환."""
    per_source: dict[str, list[dict]] = defaultdict(list)
    for i, r in enumerate(seed_rows):
        src = str(r.get("gold_source", "Unknown"))
        per_source[src].append({
            m: scores.get(m, [None] * len(seed_rows))[i] for m in METRICS
        })
    return dict(per_source)


def _write_excel(matrix: list[dict], output: Path) -> None:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "per_source"
    ws.append(["source", "n", *METRICS])
    for r in matrix:
        ws.append([r["source"], r["n"], *(round(r[m], 4) for m in METRICS)])
    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--seed", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    args = p.parse_args()

    # 1) RAGAS 평가 — 5건 단위 직렬 batch (RAGAS 0.4.3 timeout 회피)
    items = load_seed(args.seed)
    print(f"RAGAS 평가 시작: {len(items)}건 (5건 단위 직렬 batch)")
    scores = run_evaluation_in_batches(items, batch_size=5)

    # 2) gold_source 별로 그룹핑
    seed_rows = json.loads(args.seed.read_text(encoding="utf-8"))
    per_source_results = _build_per_source_results(seed_rows, scores)

    # 3) source × metric 평균 매트릭스
    matrix = compute_source_metric_matrix(per_source_results)
    _write_excel(matrix, args.output)

    print(f"\n완료: {args.output}")
    print(f"{'source':<10} {'n':>3} {'fa':>8} {'cp':>8} {'cr':>8} {'ar':>8}")
    for r in matrix:
        print(
            f"{r['source']:<10} {r['n']:>3} "
            f"{r['faithfulness']:>8.3f} {r['context_precision']:>8.3f} "
            f"{r['context_recall']:>8.3f} {r['answer_relevancy']:>8.3f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
