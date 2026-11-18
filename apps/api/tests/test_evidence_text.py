"""근거 원문 범위 자르기 — 실데이터(천성경 PDF 청크)에서 본 경계 사례를 줄여 옮겼다."""

from app.modules.hoondok.content_admin.evidence_text import evidence_paragraphs, join_chunks

# 시작 청크는 앞 말씀 꼬리로 시작하고, 말씀 5 는 다음 청크로 넘어간다(겹침 있음). 페이지 머리줄도 섞인다.
CHUNKS = [
    "의 실존을 인식하려고 하면 무리입니다. (3-10, 57.9.8, p. 24)\n결과적 존재에 대한 원인적 존재\n"
    "5 인간은 누구나 자기가 태어나고 싶어서 태어난 사람이 없습니다. 이렇게 볼 때, 궁극적인 모",
    "볼 때, 궁극적인 모델은 하나님입니다. (67-267, 73.7.22, p. 24)\n- 10 -\n"
    "6 남자와 여자가 서로 만나 생활합니다. (67-268, 73.7.22, p. 24)\n"
    "7 이 땅의 모든 것이 존재하기 위해서는 원인이 있어야 됩니다. (28-282, 70.2.11)참부모의 주체이신 하나님\n"
    "8 하나님은 이 우주의 원인적인 존재입니다. (89-75, 76.7.11, p. 25)",
]


def test_cuts_exact_range_without_previous_tail_heading_or_next_number():
    got = evidence_paragraphs(CHUNKS, 5, 7)
    assert got is not None
    assert [p.split(" ")[0] for p in got] == ["5", "6", "7"]
    # 겹침은 한 번만, 단어 중간 이음새는 붙인다
    assert "궁극적인 모델은 하나님입니다. (67-267, 73.7.22, p. 24)" in got[0]
    # 출처 괄호 뒤에 붙은 소제목은 버린다
    assert got[-1].endswith("(28-282, 70.2.11)")
    assert "- 10 -" not in " ".join(got)


def test_stops_at_number_that_starts_with_digit_text():
    chunks = ["26 하나님은 참부모입니다. (299-114, 99.2.7, p. 64)\n27 3대 주체사상의 중심은 부모입니다. (213-46, 91.1.13, p. 64)"]
    assert evidence_paragraphs(chunks, 26, 26) == ["26 하나님은 참부모입니다. (299-114, 99.2.7, p. 64)"]


def test_returns_none_when_range_is_not_closed_or_numbers_absent():
    # 끝(다음 번호)을 보지 못하면 잘린 말씀일 수 있다
    assert evidence_paragraphs(["5 인간은 누구나 태어납니다. (1-1, 70.1.1)"], 5, 5) is None
    # 평화경처럼 번호가 없는 원문
    assert evidence_paragraphs(["우리가 세계를 중심삼고 통일을 모색합니다.\n\n사람 가운데는 두 부분이 있습니다."], 4, 4) is None


def test_join_chunks_without_overlap_keeps_line_break():
    assert join_chunks(["첫 줄입니다.", "둘째 줄입니다."]) == "첫 줄입니다.\n둘째 줄입니다."
