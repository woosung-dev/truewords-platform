"""훈독 원문 표시 텍스트(PLAN-HD-008) — 원본은 두고 화면용만 정리한다."""

import json
from pathlib import Path

import pytest

from app.modules.hoondok.display_text import to_display_text

FIXTURE = Path(__file__).parent / "fixtures" / "hoondok_cheonseong_p1_chunks.json"
# 실측 PDF 줄 폭(~50자)에 맞춘 줄 — 짧은 줄 규칙이 걸리지 않게 한다.
FULL = "천일국 주인 우리 가정은 참사랑을 중심하고 하늘부모님과 참부모님의 대신 가정"


def test_empty_text_is_empty():
    assert to_display_text(None, "") == ""
    assert to_display_text("앞 청크", "   \n \n") == ""
    assert to_display_text(None, "- 3 -\n") == ""


def test_removes_overlap_with_previous_chunk():
    shared = "겹치는 문장은 앞 청크 끝과 다음 청크 머리에 같이 들어 있습니다."
    prev = f"앞 청크 본문입니다. {shared}"
    # overlap_length 는 잘라낸 뒤 50자 이상 남을 때만 자른다.
    curr = f"{shared} 이어지는 새 문장은 여기서부터 한 번만 보여야 합니다. 잔여 길이 조건을 넘도록 충분히 길게 씁니다."
    shown = to_display_text(prev, curr)
    assert shared not in shown
    assert shown.startswith("이어지는 새 문장은")
    # 앞 청크가 없으면 자르지 않는다.
    assert to_display_text(None, curr).startswith(shared)


def test_removes_page_number_lines():
    shown = to_display_text(None, f"- 2 -\n{FULL}\n  -  12  -  \n{FULL}")
    assert "- 2 -" not in shown and "12" not in shown
    # 본문 속 하이픈 숫자는 지우지 않는다.
    assert "(3-10, 57.9.8)" in to_display_text(None, "말씀입니다. (3-10, 57.9.8)")


def test_joins_spaced_title_line_as_own_paragraph():
    shown = to_display_text(None, f"{FULL}\n머 리 말\n{FULL}")
    assert shown.split("\n\n") == [FULL, "머리말", FULL]


def test_joins_spaced_run_inside_line_only_when_four_or_more():
    assert to_display_text(None, "천성경 역 사 편 찬 위 원 회") == "천성경 역사편찬위원회"
    # 연속 단음절 3개 이하는 본문 표현이다.
    assert to_display_text(None, "그 때 그 사람은 말했습니다.") == "그 때 그 사람은 말했습니다."
    assert to_display_text(None, "그 때 우리는") == "그 때 우리는"


def test_numbered_items_are_separate_paragraphs():
    text = (
        "1. 천일국 주인 우리 가정은 참사랑을 중심하고 본향 땅을 찾아 본연의 창조이상인 지상천국\n"
        "과 천상천국을 창건할 것을 맹세하나이다.\n"
        "2. 천일국 주인 우리 가정은 참사랑을 중심하고 하늘부모님과 참부모님을 모시어 천주의 대표\n"
        "적 가정이 되며 중심적 가정이 되어 가정에서는 효자, 국가에서는 충신, 세계에서는 성인, 천"
    )
    paragraphs = to_display_text(None, text).split("\n\n")
    assert len(paragraphs) == 2
    assert paragraphs[0].endswith("지상천국과 천상천국을 창건할 것을 맹세하나이다.")
    assert paragraphs[1].startswith("2. 천일국")


def test_joins_hangul_split_mid_word_without_space():
    text = f"{FULL}으로서 천\n운을 움직이는 가정이 되어 하늘의 축복을 주변에 연결시키는 가정"
    assert "천운을" in to_display_text(None, text)


def test_line_end_space_and_non_hangul_break_become_single_space():
    text = (
        "사대 심정권과 삼대왕권과 황족권을 완성할 것을 맹세하나이다 그리고 완성할   \n"
        "것을 다짐합니다 1952년 선포하신 원리원본 이후 남기신 말씀은 모두 700\n"
        "여 권에 이르며 English words wrap across the line break like this\n"
        "sample text 입니다."
    )
    shown = to_display_text(None, text)
    assert "완성할 것을" in shown
    assert "700 여 권" in shown
    assert "this sample" in shown
    assert "\n" not in shown


def test_keeps_one_paragraph_per_line_for_unwrapped_text():
    # 평화경(TXT)처럼 한 줄이 한 문단인 원본은 줄을 합치지 않는다.
    long_line = "참부모님께서는 " + "평화세계를 건설하기 위한 근원적인 처방을 제시하셨습니다. " * 3
    shown = to_display_text(None, f"머리말\n{long_line}\n{long_line}")
    assert shown.split("\n\n") == ["머리말", long_line.strip(), long_line.strip()]


def test_short_line_ends_paragraph():
    text = f"{FULL}\n명 선생님을 보내셨습니다.\n하나님은 사랑과 진리와 생명의 본체이십니다. 그리고 참부모님께서는 무형으"
    assert to_display_text(None, text).split("\n\n")[0].endswith("보내셨습니다.")


@pytest.mark.parametrize("index", range(5))
def test_cheonseong_page1_snapshot(index):
    chunks = json.loads(FIXTURE.read_text(encoding="utf-8"))["chunks"]
    prev = chunks[index - 1]["text"] if index else None
    assert to_display_text(prev, chunks[index]["text"]) == chunks[index]["display_text"]


def test_cheonseong_page1_is_clean():
    chunks = json.loads(FIXTURE.read_text(encoding="utf-8"))["chunks"]
    shown = [c["display_text"] for c in chunks]
    joined = "\n\n".join(shown)
    assert "- 2 -" not in joined and "머 리 말" not in joined
    paragraphs = joined.split("\n\n")
    for n in range(1, 9):
        assert sum(p.startswith(f"{n}. 천일국 주인") for p in paragraphs) == 1
    # 청크 3 은 청크 2 와 ~150자 겹친다 — 표시에서는 한 번만 나온다.
    assert "천주평화통일국의 실현 방안" in shown[2]
    assert "천주평화통일국의 실현 방안" not in shown[3]
    assert "천운을 움직이는" in shown[1]
