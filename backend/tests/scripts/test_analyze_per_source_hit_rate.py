"""NotebookLM treatment xlsx의 행별 hit율을 dominant source로 분해하는 휴리스틱 검증."""
from __future__ import annotations

from pathlib import Path

import pytest
from openpyxl import Workbook

from scripts.analyze_per_source_hit_rate import (
    compute_per_source_hit_table,
    extract_dominant_source,
)

HEADER = [
    "번호", "난이도(Level)", "카테고리", "테스트용 질문", "봇 모범 답변", "참고 키워드",
    "우리 답변(all)", "참고1", "참고2", "참고3", "세션ID",
]


def _write_xlsx(path: Path, rows: list[list]) -> None:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.append(HEADER)
    for r in rows:
        ws.append(r)
    wb.save(path)


def test_extract_dominant_source_picks_most_frequent() -> None:
    row = {
        "참고1": "[doc1.txt] (score=0.5, source=B)\n본문",
        "참고2": "[doc2.txt] (score=0.4, source=B)\n본문",
        "참고3": "[doc3.txt] (score=0.3, source=L)\n본문",
    }
    assert extract_dominant_source(row) == "B"


def test_extract_dominant_source_returns_unknown_when_no_marker() -> None:
    row = {"참고1": "그냥 텍스트", "참고2": "", "참고3": ""}
    assert extract_dominant_source(row) == "Unknown"


def test_compute_per_source_hit_table_aggregates_correctly(tmp_path: Path) -> None:
    p = tmp_path / "t.xlsx"
    # 3건: 모두 dominant source = B. 1건 hit / 2건 miss
    _write_xlsx(p, [
        [1, "L1", "C", "q", "a", "축복",
         "ans", "[d.txt] (score=0.5, source=B)\n축복 본문", "", "", "s1"],
        [2, "L2", "C", "q", "a", "원리강론",
         "ans", "[d.txt] (score=0.5, source=B)\n관련 없는", "", "", "s2"],
        [3, "L3", "C", "q", "a", "참부모",
         "ans", "[d.txt] (score=0.5, source=B)\n무관", "", "", "s3"],
    ])
    table = compute_per_source_hit_table(p)
    rows = {r["source"]: r for r in table}
    assert rows["B"]["n"] == 3
    assert rows["B"]["hit_rate"] == pytest.approx(1 / 3)


def test_compute_per_source_hit_table_handles_empty(tmp_path: Path) -> None:
    p = tmp_path / "t.xlsx"
    _write_xlsx(p, [])
    assert compute_per_source_hit_table(p) == []
