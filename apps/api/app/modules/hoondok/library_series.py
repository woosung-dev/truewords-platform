"""말씀 서고 저작물(시리즈) 표시 규칙 — 키는 pipeline/metadata.py `_BOOK_SERIES_RULES` 와 같다.

권리 원장(`content_rights.book_series`)에 저장된 키를 화면 제목·권 라벨·정렬로 바꾸는 단일 출처다.
등록되지 않은 키는 키 문자열 자체를 제목으로 쓴다 — 시드가 새 시리즈를 넣어도 500 을 내지 않는다.
"""

import re

# PLAN-HD-007 §2-3 이 등록 범위로 정한 6시리즈. 참어머님 말씀·기타는 이번 범위가 아니다.
BOOK_SERIES_TITLES: dict[str, str] = {
    "father_anthology": "문선명선생 말씀선집",
    "cheonseong_gyeong": "천성경",
    "pyeonghwa_gyeong": "평화경",
    "wonri_gangron": "원리강론",
    "tongil_thought": "통일사상요강",
    "chambumo_autobiography": "평화를 사랑하는 세계인으로",
}

# "말씀선집   001권.pdf" · "말씀선집 56권" 처럼 공백·확장자가 섞여 있어 숫자+권 만 집는다.
_VOLUME_NUMBER = re.compile(r"(\d{1,3})\s*권")
_LABEL_NUMBER = re.compile(r"(\d+)")
_NO_NUMBER = 10**9  # 숫자 없는 라벨은 뒤로 보낸다


def series_title(series: str) -> str:
    """시리즈 키 → 한글 제목. 미등록 키는 키 그대로."""
    return BOOK_SERIES_TITLES.get(series, series)


def volume_label(volume: str, series: str, work_title: str = "") -> str:
    """권 표시명. 말씀선집만 권 번호를 3자리로 정규화하고(`"001권"`), 나머지는 원장의 표시 제목을 쓴다."""
    if series == "father_anthology":
        matched = _VOLUME_NUMBER.search(volume)
        if matched is not None:
            return f"{int(matched.group(1)):03d}권"
    return work_title or volume


def label_sort_key(label: str) -> tuple[int, str]:
    """권 라벨 정렬 키. `"001권" < "010권" < "100권"` 이 되도록 숫자를 먼저 본다."""
    matched = _LABEL_NUMBER.search(label)
    number = int(matched.group(1)) if matched is not None else _NO_NUMBER
    return (number, label)
