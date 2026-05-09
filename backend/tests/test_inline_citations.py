# INLINE_CITATIONS 블록 파싱 회귀 잠금 테스트.
"""답변에서 INLINE_CITATIONS 블록을 추출 + 본문 strip 동작."""

from __future__ import annotations

from src.chat.prompt import parse_inline_citations


def test_parse_simple_citations():
    """기본 케이스 — 답변 본문 + INLINE_CITATIONS 블록."""
    answer = """\
참사랑은 위함을 받겠다는 사랑이 아닙니다 [1]. 우주의 원천이며 평화의 근원입니다 [2].

INLINE_CITATIONS:
[1] "위함을 받겠다는 사랑이 아니고 남을 위해 베푸는 사랑입니다"
[2] "우주의 원천이며 평화이상세계의 근거입니다"
"""

    cleaned, citations = parse_inline_citations(answer)

    assert "INLINE_CITATIONS" not in cleaned
    assert cleaned.endswith("[2].")
    assert citations[1] == "위함을 받겠다는 사랑이 아니고 남을 위해 베푸는 사랑입니다"
    assert citations[2] == "우주의 원천이며 평화이상세계의 근거입니다"


def test_parse_no_block_returns_empty():
    """블록 없으면 답변 그대로 + 빈 dict."""
    answer = "평범한 답변입니다 [1]."
    cleaned, citations = parse_inline_citations(answer)
    assert cleaned == answer
    assert citations == {}


def test_parse_partial_block():
    """[1]만 있는 케이스."""
    answer = """\
답변 본문 [1].

INLINE_CITATIONS:
[1] "참사랑입니다"
"""
    cleaned, citations = parse_inline_citations(answer)
    assert "INLINE_CITATIONS" not in cleaned
    assert citations == {1: "참사랑입니다"}


def test_parse_three_citations_with_disclaimer_appended():
    """safety_output 이 disclaimer 부착 전에 parse 되어야 — 본 fixture 는 disclaimer 없음.

    실제 service 흐름: generation 직후 parse → safety 가 disclaimer 부착.
    이 테스트는 정규식이 답변 끝에서 INLINE_CITATIONS 블록을 정확히 찾는지 잠금.
    """
    answer = """\
첫 문장 [1]. 두 번째 [2]. 세 번째 [3].

INLINE_CITATIONS:
[1] "첫 인용"
[2] "두 번째 인용"
[3] "세 번째 인용"
"""
    cleaned, citations = parse_inline_citations(answer)
    assert len(citations) == 3
    assert citations[1] == "첫 인용"
    assert citations[3] == "세 번째 인용"
    assert "세 번째 [3]." in cleaned
    assert "INLINE_CITATIONS" not in cleaned
