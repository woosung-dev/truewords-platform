"""장 목차 추출 규칙 회귀 (PLAN-HD-007 트랙 D · section_rules).

고정 표본은 2026-09-23 운영 사본에서 확인한 조판 형태를 축약한 것이다.
실데이터 커버리지는 `scripts/extract_volume_sections.py --dry-run` 이 따로 낸다.
"""

import pytest

from app.modules.hoondok.section_rules import (
    clean_title,
    extract_sections,
    normalize_spoken_on,
)


def _levels(sections: list[dict], level: int) -> list[str]:
    return [str(item["title"]) for item in sections if item["level"] == level]


# --- 공통 헬퍼 -------------------------------------------------------------


def test_clean_title_collapses_fully_spaced_hangul():
    assert clean_title("창 조 원 리") == "창조원리"
    # 일부만 띄어쓴 정상 제목은 그대로 둔다
    assert clean_title("이상세계의 주역이 될 여성") == "이상세계의 주역이 될 여성"


def test_normalize_spoken_on():
    assert normalize_spoken_on("1956년 4월 8일(日), 전 본부교회.") == "1956-04-08"
    assert normalize_spoken_on("날짜 없음") is None
    assert normalize_spoken_on("1956년 13월 8일") is None


def test_unknown_series_and_empty_input():
    assert extract_sections("mother_anthology", [(0, "본문")]) == []
    assert extract_sections("cheonseong_gyeong", []) == []


# --- 천성경 ----------------------------------------------------------------

CHEONSEONG = [
    (0, "천성경\n| 차 례 |"),
    (1, "제1편 하나님                    21\n제2편 참부모                    141"),
    (2, "제 1 편 하나님\n제1장 하나님의 존재와 속성\n1 만물은 형상적인 꼴을 가지고 있습니다."),
    (3, "본문이 이어집니다."),
    (4, "제2장 심정과 참사랑이신 하나님\n본문."),
    (5, "제 2 편 참부모\n제1장 참부모란\n본문."),
]


def test_cheonseong_skips_toc_lines_with_page_numbers():
    sections = extract_sections("cheonseong_gyeong", CHEONSEONG)
    assert _levels(sections, 1) == ["하나님", "참부모"]
    assert _levels(sections, 2) == [
        "하나님의 존재와 속성",
        "심정과 참사랑이신 하나님",
        "참부모란",
    ]
    first = sections[0]
    assert (first["start_chunk_index"], first["end_chunk_index"]) == (2, 4)


# --- 평화경 ----------------------------------------------------------------

PYEONGHWA = [
    (0, "제1편 참평화의 근본원리\t17\n제2편 하나님의 조국과 평화왕국\t199"),
    (1, "제1편 참평화의 근본원리\t19\t차례\n1. 하나님과 인간을 위한 이상세계 (1972.2.4)\t19"),
    (
        2,
        "제1편 참평화의 근본원리\t19\t차례\n"
        "1. 하나님과 인간을 위한 이상세계 (1972.2.4)\n"
        "날 짜 : 1972년 2월 4일\n본문.",
    ),
    (3, "2. 인간에 대한 하나님의 소망\n날 짜 : 1973년 10월 20일\n본문."),
    (4, "제2편 하나님의 조국과 평화왕국\t200\t차례\n1. 통일교회 창립 의의와 배경\t201"),
    (5, "1. 통일교회 창립 의의와 배경 (1970.7.15)\n날 짜 : 1970년 7월 15일\n본문."),
]


def test_pyeonghwa_uses_running_header_for_pyeon_and_confirms_speech():
    sections = extract_sections("pyeonghwa_gyeong", PYEONGHWA)
    assert _levels(sections, 1) == ["참평화의 근본원리", "하나님의 조국과 평화왕국"]
    assert _levels(sections, 2) == [
        "하나님과 인간을 위한 이상세계",
        "인간에 대한 하나님의 소망",
        "통일교회 창립 의의와 배경",
    ]
    speeches = [item for item in sections if item["level"] == 2]
    assert speeches[0]["spoken_on"] == "1972-02-04"
    # 앞머리 전체 목차(청크 0)는 건너뛴다
    assert sections[0]["start_chunk_index"] == 2


def test_pyeonghwa_ignores_numbered_line_without_date_confirmation():
    chunks = [
        (0, "1. 하나님과 인간을 위한 이상세계 (1972.2.4)\n날 짜 : 1972년 2월 4일"),
        (1, "1. 이것은 본문 안의 열거일 뿐입니다\n계속되는 문장."),
    ]
    assert len(extract_sections("pyeonghwa_gyeong", chunks)) == 1


# --- 원리강론 · 통일사상요강 ------------------------------------------------

WONRI = [
    (0, "제 1 장 창 조 원 리\n제 1 절 하나님의 이성성상과 피조세계\n본문."),
    (1, "제2절 만유원력과 수수작용 89\n본문."),
    (2, "제2절 만유원력과 수수작용\n같은 절이 겹쳐 실린 경우."),
    (3, "제2장 타락론 70\n제1절 죄의 뿌리\n본문."),
    (
        4,
        "제7장 제1절). 그러나 인간은 타락으로 인하여, 이러한 가치를 모두 잃어버리고 말았다.\n본문.",
    ),
    (5, "제1장 복귀기대섭리시대\n본문."),
]


def test_wonri_handles_page_suffix_restart_and_body_citation():
    sections = extract_sections("wonri_gangron", WONRI)
    assert _levels(sections, 1) == ["창조원리", "타락론", "복귀기대섭리시대"]
    assert _levels(sections, 2) == [
        "하나님의 이성성상과 피조세계",
        "만유원력과 수수작용",
        "죄의 뿌리",
    ]


def test_tongil_thought_finds_chapters_without_sections():
    chunks = [
        (0, "三. 統一方法論... 676\n제1장 원 상 론\nTheory of the Original Image"),
        (1, "본문."),
        (2, "제2장 존 재 론\n본문."),
    ]
    sections = extract_sections("tongil_thought", chunks)
    assert _levels(sections, 1) == ["원상론", "존재론"]
    assert _levels(sections, 2) == []


# --- 자서전 ----------------------------------------------------------------


def test_autobiography_chapter_and_quoted_subheadings():
    chunks = [
        (0, "﻿1장. 밥이 사랑이다\n\n‘아버지 등에 업혀 배운 평화’\n\n본문."),
        (1, "‘아버지 등에 업혀 배운 평화’\n같은 소제목이 겹쳐 실린 경우."),
        (2, "‘사람들에게 밥을 먹이는 기쁨’\n본문."),
        (3, "2장. 눈물로 채운 마음의 강\n본문."),
    ]
    sections = extract_sections("chambumo_autobiography", chunks)
    assert _levels(sections, 1) == ["밥이 사랑이다", "눈물로 채운 마음의 강"]
    assert _levels(sections, 2) == ["아버지 등에 업혀 배운 평화", "사람들에게 밥을 먹이는 기쁨"]


# --- 말씀선집 --------------------------------------------------------------

FATHER = [
    (0, "文鮮明先生말씀選集\n머 리 말"),
    (1, "차    례\n  머리말 …………………………………………………… 3"),
    (2, "01)\n승리하는 하나님의 정병이 되자\n<기 도> 아버님."),
    (3, "본문이 이어집니다.\n1956년 4월 8일(日), 전 본부교회."),
    (4, "8   승리하는 하나님의 정병이 되자\n본문."),
    (20, "2)\n하나님의 자랑이 된 예수 그리스도\n본문."),
    (21, "10   하나님의 자랑이 된 예수 그리스도\n본문.\n1957년 3월 3일, 전 본부교회."),
]


def test_father_anthology_segments_by_ordinal_and_signature():
    sections = extract_sections("father_anthology", FATHER)
    assert [item["level"] for item in sections] == [1, 1]
    assert _levels(sections, 1) == [
        "승리하는 하나님의 정병이 되자",
        "하나님의 자랑이 된 예수 그리스도",
    ]
    assert sections[0]["start_chunk_index"] == 2
    assert sections[0]["end_chunk_index"] == 19
    assert sections[0]["spoken_on"] == "1956-04-08"
    assert sections[0]["place"] == "전 본부교회"


def test_father_anthology_falls_back_to_page_headers():
    """번호 줄·날짜 서명이 없고 쪽 머리글만 있는 권(예: 일부 200 번대)."""
    chunks = [
        (0, "머 리 말\n차    례"),
        (1, "8   첫 번째 말씀\n본문."),
        (2, "9   첫 번째 말씀\n본문."),
        (20, "10   두 번째 말씀\n본문."),
    ]
    sections = extract_sections("father_anthology", chunks)
    assert _levels(sections, 1) == ["첫 번째 말씀", "두 번째 말씀"]


def test_father_anthology_without_signals_returns_nothing():
    chunks = [(0, "머 리 말"), (1, "제목 없는 본문."), (2, "이어지는 본문.")]
    assert extract_sections("father_anthology", chunks) == []


# --- 불변식 ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("series", "chunks"),
    [
        ("cheonseong_gyeong", CHEONSEONG),
        ("pyeonghwa_gyeong", PYEONGHWA),
        ("wonri_gangron", WONRI),
        ("father_anthology", FATHER),
    ],
)
def test_sections_do_not_overlap_within_a_level(series: str, chunks: list[tuple[int, str]]):
    sections = extract_sections(series, chunks)
    assert sections
    positions = [item["position"] for item in sections]
    assert positions == list(range(1, len(sections) + 1))
    for level in (1, 2):
        rows = [item for item in sections if item["level"] == level]
        for item in rows:
            assert item["start_chunk_index"] <= item["end_chunk_index"]
            assert len(str(item["title"])) <= 200
        for earlier, later in zip(rows, rows[1:], strict=False):
            assert earlier["end_chunk_index"] < later["start_chunk_index"]
    # level 2 구간은 자기를 품는 level 1 구간을 넘지 않는다
    parent = None
    for item in sections:
        if item["level"] == 1:
            parent = item
        elif parent is not None:
            assert parent["start_chunk_index"] <= item["start_chunk_index"]
            assert item["end_chunk_index"] <= parent["end_chunk_index"]
