"""NotebookLM 카테고리 hit율 분석 스크립트 단위 테스트.

휴리스틱 hit 판정: 참고키워드(쉼표 분리)의 절반 이상 토큰이 참고1+참고2+참고3 텍스트에 포함되면 hit.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from openpyxl import Workbook

from scripts.analyze_notebooklm_categories import (
    compute_category_hit_table,
    extract_improvements,
    extract_regressions,
)

HEADER = [
    "번호", "Level", "카테고리", "질문", "모범답변", "참고키워드",
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


def test_category_hit_rate_counts_l1_to_l5(tmp_path: Path) -> None:
    base = tmp_path / "base.xlsx"
    tune = tmp_path / "tune.xlsx"
    # baseline: L1 hit (token "축복" 매치), L5 miss (token "원리강론" 미매치)
    _write_xlsx(base, [
        [1, "L1", "교리", "축복이 무엇인가", "축복은 결혼식이다", "축복",
         "축복은 결혼식입니다", "축복 관련 청크", "", "", "s1"],
        [2, "L5", "역사", "원리강론 출간 연도?", "원리강론은 1966년 출간", "원리강론",
         "잘 모르겠습니다", "관련 없는 청크", "", "", "s2"],
    ])
    # treatment: L1 hit, L5 hit
    _write_xlsx(tune, [
        [1, "L1", "교리", "축복이 무엇인가", "축복은 결혼식이다", "축복",
         "축복은 결혼식입니다", "축복 관련 청크", "", "", "s1"],
        [2, "L5", "역사", "원리강론 출간 연도?", "원리강론은 1966년 출간", "원리강론",
         "원리강론은 1966년에 출간되었습니다", "원리강론 1966 청크", "", "", "s2"],
    ])
    table = compute_category_hit_table(base, tune)
    rows = {row["level"]: row for row in table}
    assert rows["L1"]["baseline_hit_rate"] == pytest.approx(1.0)
    assert rows["L1"]["treatment_hit_rate"] == pytest.approx(1.0)
    assert rows["L5"]["baseline_hit_rate"] == pytest.approx(0.0)
    assert rows["L5"]["treatment_hit_rate"] == pytest.approx(1.0)
    assert rows["L5"]["delta"] == pytest.approx(1.0)


def test_extract_regressions_returns_rows_below_threshold(tmp_path: Path) -> None:
    base = tmp_path / "base.xlsx"
    tune = tmp_path / "tune.xlsx"
    # baseline hit, treatment miss → 회귀 1건
    _write_xlsx(base, [
        [1, "L3", "교리", "축복이 무엇인가", "축복은 결혼식이다", "축복",
         "축복은 결혼식입니다", "축복 청크", "", "", "s1"],
    ])
    _write_xlsx(tune, [
        [1, "L3", "교리", "축복이 무엇인가", "축복은 결혼식이다", "축복",
         "잘 모르겠습니다", "관련 없는 청크", "", "", "s1"],
    ])
    regs = extract_regressions(base, tune)
    assert len(regs) == 1
    assert regs[0]["번호"] == 1
    assert "회귀 답변" not in regs[0]["베이스 답변"]


def test_empty_input_returns_empty_dataframe(tmp_path: Path) -> None:
    base = tmp_path / "base.xlsx"
    tune = tmp_path / "tune.xlsx"
    _write_xlsx(base, [])
    _write_xlsx(tune, [])
    assert compute_category_hit_table(base, tune) == []
    assert extract_regressions(base, tune) == []
    assert extract_improvements(base, tune) == []
