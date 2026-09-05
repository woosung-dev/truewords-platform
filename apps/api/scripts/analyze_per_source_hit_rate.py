"""NotebookLM treatment xlsx의 행별 hit율을 dominant source로 분해 (옵션 G fallback).

휴리스틱:
- dominant source = 행의 참고1+참고2+참고3 셀에서 ``source=X`` 패턴이 가장 자주 등장한 코드
- hit = 참고 키워드(쉼표 분리) 토큰 절반 이상이 참고1+2+3 텍스트에 포함

RAGAS 4메트릭 측정이 timeout 폭주로 작동 불가할 때 단일 메트릭(hit율)로 약점 source를
식별하는 fallback. 옵션 D에서 측정한 NotebookLM 200건 xlsx에 그대로 적용 가능.

사용 예:
    PYTHONPATH=. uv run python scripts/analyze_per_source_hit_rate.py \\
        --input ~/Downloads/notebooklm_post_phase1_20260428_1001_light100.xlsx \\
        ~/Downloads/notebooklm_post_phase1_20260428_1001_cheonilguk50.xlsx \\
        ~/Downloads/notebooklm_post_phase1_20260428_1001_chambumo50.xlsx \\
        --output ~/Downloads/per_source_hit_rate_20260428.xlsx
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import Workbook

from scripts.analyze_notebooklm_categories import _is_hit, _load_rows


SOURCE_RE = re.compile(r"source=([A-T])")


def extract_dominant_source(row: dict) -> str:
    cited = " ".join(str(row.get(k) or "") for k in ("참고1", "참고2", "참고3"))
    codes = SOURCE_RE.findall(cited)
    if not codes:
        return "Unknown"
    return Counter(codes).most_common(1)[0][0]


def compute_per_source_hit_table(*paths: Path) -> list[dict]:
    """여러 xlsx에서 행을 모아 dominant source별 hit율 산출."""
    by_source: dict[str, list[bool]] = defaultdict(list)
    total = 0
    for p in paths:
        if not p.exists():
            continue
        for r in _load_rows(p):
            src = extract_dominant_source(r)
            by_source[src].append(_is_hit(r))
            total += 1
    if not by_source:
        return []
    out: list[dict] = []
    for src in sorted(by_source):
        hits = by_source[src]
        n = len(hits)
        out.append({
            "source": src,
            "n": n,
            "share_pct": (n / total * 100) if total else 0.0,
            "hit_rate": sum(1 for h in hits if h) / n if n else 0.0,
        })
    return out


def _write_excel(table: list[dict], output: Path) -> None:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "per_source_hit"
    ws.append(["source", "n", "share_pct", "hit_rate"])
    for r in table:
        ws.append([
            r["source"], r["n"],
            round(r["share_pct"], 2),
            round(r["hit_rate"], 4),
        ])
    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, type=Path, nargs="+", help="treatment xlsx 1개 이상")
    p.add_argument("--output", required=True, type=Path)
    args = p.parse_args()

    table = compute_per_source_hit_table(*args.input)
    _write_excel(table, args.output)

    print(f"\n완료: {args.output}")
    print(f"{'source':<10} {'n':>4} {'share_pct':>10} {'hit_rate':>10}")
    for r in table:
        print(
            f"{r['source']:<10} {r['n']:>4} "
            f"{r['share_pct']:>10.2f} {r['hit_rate']:>10.3f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
