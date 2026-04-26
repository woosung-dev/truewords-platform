"""1차 vs 2차 baseline 정량 비교.

사용:
    uv run python scripts/baseline_diff.py \
        --before reports/baseline_20260425_170508.jsonl \
        --after reports/baseline_<new_ts>.jsonl

출력: status / latency / citations / 카테고리별 변화 + 답변 텍스트 변화 건수.
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter
from pathlib import Path


def load(path: Path) -> dict[str, dict]:
    return {r["id"]: r for r in (json.loads(l) for l in path.open())}


def stats(recs: list[dict]) -> dict:
    lats = [r["latency_ms"] for r in recs if r.get("latency_ms")]
    cits = [r.get("citations_count", 0) for r in recs]
    return {
        "total": len(recs),
        "status": dict(Counter(r.get("status_code") for r in recs)),
        "category": dict(Counter(r.get("category") for r in recs)),
        "lat_p50": statistics.median(lats) if lats else 0,
        "lat_p95": sorted(lats)[int(len(lats) * 0.95)] if lats else 0,
        "lat_mean": statistics.mean(lats) if lats else 0,
        "cit_mean": sum(cits) / len(cits) if cits else 0,
        "zero_cit": sum(1 for c in cits if c == 0),
    }


def category_breakdown(recs: list[dict]) -> dict[str, dict]:
    by_cat: dict[str, list[dict]] = {}
    for r in recs:
        by_cat.setdefault(r.get("category", "?"), []).append(r)
    return {cat: stats(rs) for cat, rs in by_cat.items()}


def adversarial_safety(recs: list[dict]) -> dict:
    """adversarial / out_of_scope 카테고리에서 정상 거부 (찾지 못했습니다 포함) 비율."""
    refused_phrases = ("찾지 못했습니다", "답변할 수 없", "범위", "관련 없")
    counts = {"adversarial": [0, 0], "out_of_scope": [0, 0]}  # [refused, total]
    for r in recs:
        cat = r.get("category")
        if cat not in counts:
            continue
        counts[cat][1] += 1
        ans = r.get("answer", "") or ""
        if any(p in ans for p in refused_phrases):
            counts[cat][0] += 1
    return {
        cat: f"{c[0]}/{c[1]} ({100 * c[0] / c[1]:.0f}%)" if c[1] else "0/0"
        for cat, c in counts.items()
    }


def text_diff_count(before_map: dict, after_map: dict) -> dict:
    """동일 id 의 답변 텍스트가 다른 건수."""
    common_ids = set(before_map) & set(after_map)
    same = sum(
        1
        for i in common_ids
        if before_map[i].get("answer", "") == after_map[i].get("answer", "")
    )
    diff = len(common_ids) - same
    return {
        "common": len(common_ids),
        "same_answer": same,
        "diff_answer": diff,
        "diff_pct": f"{100 * diff / len(common_ids):.0f}%" if common_ids else "0%",
    }


def fmt(d: dict, indent: int = 0) -> str:
    pre = "  " * indent
    out = []
    for k, v in d.items():
        if isinstance(v, dict):
            out.append(f"{pre}{k}:")
            out.append(fmt(v, indent + 1))
        elif isinstance(v, float):
            out.append(f"{pre}{k}: {v:.1f}")
        else:
            out.append(f"{pre}{k}: {v}")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", type=Path, required=True)
    ap.add_argument("--after", type=Path, required=True)
    args = ap.parse_args()

    before_map = load(args.before)
    after_map = load(args.after)
    before_recs = list(before_map.values())
    after_recs = list(after_map.values())

    print("=" * 60)
    print(f"BEFORE: {args.before.name} ({len(before_recs)}건)")
    print(f"AFTER:  {args.after.name} ({len(after_recs)}건)")
    print("=" * 60)

    print("\n[전체 통계]")
    print("BEFORE:")
    print(fmt(stats(before_recs), 1))
    print("AFTER:")
    print(fmt(stats(after_recs), 1))

    print("\n[카테고리별 latency mean (ms)]")
    b = category_breakdown(before_recs)
    a = category_breakdown(after_recs)
    print(f"  {'category':<15} {'before':>12} {'after':>12} {'delta':>10}")
    for cat in sorted(set(b) | set(a)):
        bm = b.get(cat, {}).get("lat_mean", 0)
        am = a.get(cat, {}).get("lat_mean", 0)
        delta = am - bm
        print(f"  {cat:<15} {bm:>12.1f} {am:>12.1f} {delta:>+10.1f}")

    print("\n[adversarial / out_of_scope 거부율]")
    print("BEFORE:", adversarial_safety(before_recs))
    print("AFTER: ", adversarial_safety(after_recs))

    print("\n[답변 텍스트 변화]")
    print(fmt(text_diff_count(before_map, after_map), 1))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
