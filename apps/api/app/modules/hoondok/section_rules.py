"""말씀 서고 장 목차 추출 규칙 (PLAN-HD-007 트랙 D).

Qdrant 본문 청크만으로 저작물별 장·절 경계를 찾는 순수 함수 묶음이다.
DB·네트워크에 닿지 않으므로 고정 표본으로 단위 테스트할 수 있고, I/O 는
``scripts/extract_volume_sections.py`` 가 맡는다. LLM 은 쓰지 않는다.

입력은 항상 ``[(chunk_index, text), ...]`` (오름차순), 출력은 다음 키를 가진 dict 다.

    position, level, title, start_chunk_index, end_chunk_index, spoken_on, place

규칙은 2026-09-23 운영 사본(417,579 청크)에서 실측한 신호를 따른다. 저작물별 근거는
각 규칙 상수의 주석에 있다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MAX_TITLE_LENGTH = 200
MAX_PLACE_LENGTH = 120
# 헤딩 후보 줄 길이 상한 — 본문이 "제7장 제1절). 그러나 …" 처럼 장·절을 인용하는 사례를 거른다.
MAX_HEADING_LINE = 60

Chunk = tuple[int, str]
Section = dict[str, object]

_SPACES = re.compile(r"\s+")
# 쪽 번호·"차례" 꼬리. 목차(TOC) 줄과 쪽 머리글이 공통으로 달고 있다.
_PAGE_SUFFIX = re.compile(r"(?:\s*차\s*례)?\s*\d{1,4}(?:\s*차\s*례)?$")
_TRAILING_DIGITS = re.compile(r"\d$")
# "창 조 원 리" 처럼 제목 전체를 낱글자로 띄워 조판한 경우에만 붙인다.
# 일부만 걸러내면 "주역이 될 여성" 같은 정상 제목이 뭉개진다.
_SPACED_HANGUL = re.compile(r"^(?:[가-힣]\s){2,}[가-힣]$")
_KOREAN_DATE = re.compile(r"((?:19|20)\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일")


def normalize_line(raw: str) -> str:
    """BOM·연속 공백을 정리한 한 줄."""
    return _SPACES.sub(" ", raw.replace("﻿", "")).strip()


def clean_title(raw: str) -> str:
    """제목 정규화 — 공백 축약, 낱글자 띄어쓰기 복원, 길이 제한."""
    title = _SPACES.sub(" ", raw.replace("﻿", "")).strip(" .·:\t")
    for matched in _SPACED_HANGUL.finditer(title):
        title = title.replace(matched.group(0), matched.group(0).replace(" ", ""))
    return title[:MAX_TITLE_LENGTH]


def normalize_spoken_on(text: str) -> str | None:
    """"1956년 4월 8일" → "1956-04-08". 못 읽으면 None."""
    matched = _KOREAN_DATE.search(text)
    if matched is None:
        return None
    year, month, day = (int(g) for g in matched.groups())
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


# --- 헤딩 규칙 기반 저작물 -------------------------------------------------


@dataclass(frozen=True)
class HeadingRule:
    """한 레벨의 헤딩 규칙.

    Attributes:
        level: 1 편·장, 2 장·절·설교.
        pattern: ``num``(선택)·``title`` 그룹을 갖는 정규식.
        allow_page_suffix: True 면 꼬리 쪽 번호를 떼고 받아들인다(본문 헤딩에도
            쪽 번호가 붙는 원리강론·평화경). False 면 숫자로 끝나는 줄을 목차로 보고 버린다.
        confirm_next: 다음 비어 있지 않은 줄이 이 패턴과 맞아야 헤딩으로 인정한다
            (평화경 설교 제목의 "날 짜 :" 확인). 규칙에 날짜 그룹이 잡히면 생략된다.
    """

    level: int
    pattern: re.Pattern[str]
    allow_page_suffix: bool = False
    confirm_next: re.Pattern[str] | None = None


@dataclass(frozen=True)
class SeriesRule:
    """저작물 하나의 추출 규칙."""

    headings: tuple[HeadingRule, ...] = ()
    # 이 레벨의 첫 본문 헤딩이 나오는 청크부터 훑는다(앞머리 전체 목차 회피). None 이면 0 부터.
    body_start_level: int | None = None
    # 헤딩 후보 줄 길이 상한. 본문이 장·절을 인용하는 저작물은 더 좁힌다.
    max_line: int = MAX_HEADING_LINE
    speeches: bool = False  # 말씀선집 전용 경로
    extras: dict[str, object] = field(default_factory=dict)


_DATE_TAIL = r"(?:\s*\((?P<y>\d{4})\.\s*(?P<m>\d{1,2})\.\s*(?P<d>\d{1,2})\)\s*)?"

SERIES_RULES: dict[str, SeriesRule] = {
    # 천성경: 앞머리 차례 줄은 모두 쪽 번호로 끝나고 본문 헤딩은 끝나지 않는다.
    "cheonseong_gyeong": SeriesRule(
        headings=(
            HeadingRule(1, re.compile(r"^제\s*(?P<num>\d+)\s*편\s+(?P<title>.+)$")),
            HeadingRule(2, re.compile(r"^제\s*(?P<num>\d+)\s*장\s+(?P<title>.+)$")),
        )
    ),
    # 평화경: 편 헤딩은 본문에서도 "제2편 … 200 차례" 꼴 쪽 머리글로만 나온다.
    # 그래서 편은 꼬리를 떼고 받고, 스캔 시작점은 첫 설교 제목이 나오는 청크로 잡는다.
    "pyeonghwa_gyeong": SeriesRule(
        headings=(
            HeadingRule(
                1,
                re.compile(r"^제\s*(?P<num>\d+)\s*편\s+(?P<title>.+)$"),
                allow_page_suffix=True,
            ),
            HeadingRule(
                2,
                re.compile(r"^(?P<num>\d{1,2})\.\s+(?P<title>.+?)" + _DATE_TAIL + r"$"),
                confirm_next=re.compile(r"^날\s*짜\s*[:：]"),
            ),
        ),
        body_start_level=2,
    ),
    # 원리강론: 전편·후편에서 장 번호가 1 로 되돌아간다. 본문 헤딩에도 쪽 번호가 붙는다.
    "wonri_gangron": SeriesRule(
        headings=(
            HeadingRule(
                1,
                re.compile(r"^제\s*(?P<num>\d+)\s*장\s*(?P<title>.*)$"),
                allow_page_suffix=True,
            ),
            HeadingRule(
                2,
                re.compile(r"^제\s*(?P<num>\d+)\s*절\s*(?P<title>.*)$"),
                allow_page_suffix=True,
            ),
        ),
        max_line=40,
    ),
    # 통일사상요강: 장만 있고 절은 한자 번호(一·二)라 잡지 않는다 — 장 11 개가 정상이다.
    "tongil_thought": SeriesRule(
        headings=(
            HeadingRule(
                1,
                re.compile(r"^제\s*(?P<num>\d+)\s*장\s*(?P<title>.*)$"),
                allow_page_suffix=True,
            ),
            HeadingRule(
                2,
                re.compile(r"^제\s*(?P<num>\d+)\s*절\s*(?P<title>.*)$"),
                allow_page_suffix=True,
            ),
        ),
        max_line=40,
    ),
    # 자서전: "1장. 밥이 사랑이다" 장 헤딩 + 홑따옴표로 감싼 소제목 줄.
    "chambumo_autobiography": SeriesRule(
        headings=(
            HeadingRule(1, re.compile(r"^(?P<num>\d{1,2})\s*장\s*[.·]\s*(?P<title>.+)$")),
            HeadingRule(2, re.compile(r"^[‘“](?P<title>.{3,60})[’”]$")),
        )
    ),
    "father_anthology": SeriesRule(speeches=True),
}


def extract_sections(series: str, chunks: list[Chunk]) -> list[Section]:
    """저작물 키와 청크 목록으로 장 목차를 만든다. 규칙이 없거나 신호가 없으면 빈 목록."""
    rule = SERIES_RULES.get(series)
    if rule is None or not chunks:
        return []
    ordered = sorted(chunks, key=lambda item: item[0])
    if rule.speeches:
        return extract_father_anthology(ordered)
    return _extract_by_headings(ordered, rule)


# --- 공통 헤딩 엔진 -------------------------------------------------------


def _lines(text: str) -> list[str]:
    return [normalize_line(line) for line in text.split("\n")]


def _match_rule(
    heading: HeadingRule, line: str, following: list[str]
) -> tuple[int | None, str, str | None] | None:
    """(번호, 제목, spoken_on) 또는 None. 목차 줄·확인 실패는 None."""
    matched = heading.pattern.match(line)
    if matched is None:
        return None
    groups = matched.groupdict()
    title = groups.get("title") or ""
    spoken_on: str | None = None
    if groups.get("y"):
        spoken_on = f"{int(groups['y']):04d}-{int(groups['m']):02d}-{int(groups['d']):02d}"
    if heading.allow_page_suffix:
        title = _PAGE_SUFFIX.sub("", title)
    elif _TRAILING_DIGITS.search(line):
        return None  # 쪽 번호로 끝나는 줄 = 차례
    if heading.confirm_next is not None and spoken_on is None:
        nxt = next((item for item in following if item), "")
        if heading.confirm_next.match(nxt) is None:
            return None
    title = clean_title(title)
    if not title:
        return None
    number = int(groups["num"]) if groups.get("num") else None
    return number, title, spoken_on


def _accepts(number: int | None, title: str, last_number: int, last_title: str) -> bool:
    """번호가 있으면 증가(또는 1 로 재시작)만, 없으면 직전 제목과 다를 때만 받는다.

    같은 헤딩이 이웃 청크에 겹쳐 실리는 PDF 추출 특성 때문에 중복 제거가 필요하다.
    """
    if number is None:
        return title != last_title
    if number > last_number:
        return True
    return number == 1 and last_number >= 2


def _body_start(chunks: list[Chunk], rule: SeriesRule) -> int:
    if rule.body_start_level is None:
        return chunks[0][0]
    target = next(h for h in rule.headings if h.level == rule.body_start_level)
    for index, (chunk_index, text) in enumerate(chunks):
        lines = _lines(text)
        for position, line in enumerate(lines):
            if len(line) > rule.max_line:
                continue
            if _match_rule(target, line, lines[position + 1 :]) is not None:
                return chunk_index
        del index
    return chunks[0][0]


def _extract_by_headings(chunks: list[Chunk], rule: SeriesRule) -> list[Section]:
    start_from = _body_start(chunks, rule)
    last_number = {heading.level: 0 for heading in rule.headings}
    last_title = {heading.level: "" for heading in rule.headings}
    found: list[tuple[int, int, str, str | None]] = []  # (chunk, level, title, spoken_on)

    for chunk_index, text in chunks:
        if chunk_index < start_from:
            continue
        lines = _lines(text)
        for position, line in enumerate(lines):
            if not line or len(line) > rule.max_line:
                continue
            for heading in rule.headings:
                parsed = _match_rule(heading, line, lines[position + 1 :])
                if parsed is None:
                    continue
                number, title, spoken_on = parsed
                if not _accepts(number, title, last_number[heading.level], last_title[heading.level]):
                    break
                last_number[heading.level] = number or 0
                last_title[heading.level] = title
                for deeper in rule.headings:
                    if deeper.level > heading.level:
                        last_number[deeper.level] = 0
                        last_title[deeper.level] = ""
                found.append((chunk_index, heading.level, title, spoken_on))
                break

    return _to_sections(found, chunks[-1][0])


def _to_sections(
    found: list[tuple[int, int, str, str | None]], last_chunk: int
) -> list[Section]:
    """헤딩 목록 → 구간. 끝은 같은 레벨 이상의 다음 헤딩 직전까지."""
    sections: list[Section] = []
    for index, (chunk_index, level, title, spoken_on) in enumerate(found):
        end = last_chunk
        for later_chunk, later_level, _, _ in found[index + 1 :]:
            if later_level <= level:
                end = later_chunk - 1
                break
        sections.append(
            {
                "position": index + 1,
                "level": level,
                "title": title,
                "start_chunk_index": chunk_index,
                "end_chunk_index": max(chunk_index, end),
                "spoken_on": spoken_on,
                "place": None,
            }
        )
    return sections


# --- 말씀선집 (설교 경계) --------------------------------------------------

# 설교 번호 줄. "01)" · "12)" 처럼 홀로 선다 — 20 권 표본에서 가장 정확한 경계 신호였다.
_SPEECH_ORDINAL = re.compile(r"^(\d{1,3})\)$")
# 설교 끝 서명. "1956년 4월 8일(日), 전 본부교회."
_SIGNATURE = re.compile(r"^((?:19|20)\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일(?P<rest>.*)$")
# 쪽 머리글. "10   승리하는 하나님의 정병이 되자"
_PAGE_HEADER = re.compile(r"^\d{1,3}\s{2,}(?P<title>.{4,60})$")
# 앞머리 차례의 점선. "머리말 …………… 3"
_DOT_LEADER = re.compile(r"[…·.]{5,}")
_FRONT_MATTER_SCAN = 15
# 두 신호가 같은 설교를 가리킬 때 합치는 간격(청크). 표본에서 기도 끝 서명과 번호 줄이
# 최대 3 청크 떨어져 나타났다.
_MERGE_GAP = 4


def extract_father_anthology(chunks: list[Chunk]) -> list[Section]:
    """말씀선집 한 권 → 설교 단위 level 1 구간.

    경계는 설교 번호 줄과 날짜 서명(서명이 있는 청크에서 설교가 끝난다)을 합친다.
    둘 다 없으면 쪽 머리글 제목이 바뀌는 지점을 쓰고, 그것도 없으면 빈 목록이다.
    """
    start_from = _front_matter_end(chunks)
    ordinals: list[int] = []
    signatures: list[tuple[int, str]] = []
    headers: list[tuple[int, str]] = []
    last_ordinal = 0

    for chunk_index, text in chunks:
        if chunk_index < start_from:
            continue
        for raw in text.split("\n"):
            # 쪽 머리글은 "번호 + 넓은 공백 + 제목" 조판이라 공백을 줄이기 전에 본다.
            header = _PAGE_HEADER.match(raw.replace("\ufeff", "").strip())
            if header is not None:
                title = clean_title(header.group("title"))
                if title and (not headers or headers[-1][1] != title):
                    headers.append((chunk_index, title))
                continue
            line = normalize_line(raw)
            if not line:
                continue
            matched = _SPEECH_ORDINAL.match(line)
            if matched is not None and int(matched.group(1)) > last_ordinal:
                last_ordinal = int(matched.group(1))
                ordinals.append(chunk_index)
                continue
            if _SIGNATURE.match(line) is not None:
                if not signatures or signatures[-1][1] != line:
                    signatures.append((chunk_index, line))

    starts = _speech_starts(start_from, ordinals, signatures, headers)
    if not starts:
        return []

    last_chunk = chunks[-1][0]
    text_by_chunk = dict(chunks)
    sections: list[Section] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] - 1 if index + 1 < len(starts) else last_chunk
        end = max(start, end)
        title = _speech_title(start, end, headers, text_by_chunk, index)
        spoken_on, place = _signature_of(start, end, signatures)
        sections.append(
            {
                "position": index + 1,
                "level": 1,
                "title": title,
                "start_chunk_index": start,
                "end_chunk_index": end,
                "spoken_on": spoken_on,
                "place": place,
            }
        )
    return sections


def _front_matter_end(chunks: list[Chunk]) -> int:
    """머리말·차례 청크 다음 청크. 신호가 없으면 첫 청크."""
    start = chunks[0][0]
    for chunk_index, text in chunks:
        if chunk_index - start >= _FRONT_MATTER_SCAN:
            break
        if _DOT_LEADER.search(text) or "차 례" in text or "차    례" in text:
            start = chunk_index + 1
    return start


def _speech_starts(
    body_start: int,
    ordinals: list[int],
    signatures: list[tuple[int, str]],
    headers: list[tuple[int, str]],
) -> list[int]:
    if not ordinals and not signatures:
        return sorted({chunk for chunk, _ in headers}) if len(headers) >= 2 else []
    candidates = set(ordinals)
    candidates.update(chunk + 1 for chunk, _ in signatures[:-1])
    candidates.add(body_start)
    merged: list[int] = []
    for candidate in sorted(candidates):
        if not merged or candidate - merged[-1] > _MERGE_GAP:
            merged.append(candidate)
    return merged


def _speech_title(
    start: int,
    end: int,
    headers: list[tuple[int, str]],
    text_by_chunk: dict[int, str],
    index: int,
) -> str:
    for chunk_index, title in headers:
        if start <= chunk_index <= end:
            return title
    # 첫 청크의 첫 의미 있는 줄. 쪽 번호·번호 줄은 제목이 아니다.
    for line in _lines(text_by_chunk.get(start, "")):
        candidate = clean_title(line)
        if len(candidate) >= 4 and not candidate.isdigit() and len(line) <= MAX_HEADING_LINE:
            return candidate
    return f"설교 {index + 1}"


def _signature_of(
    start: int, end: int, signatures: list[tuple[int, str]]
) -> tuple[str | None, str | None]:
    """구간 안 마지막 서명에서 (spoken_on, place)."""
    chosen: str | None = None
    for chunk_index, line in signatures:
        if start <= chunk_index <= end:
            chosen = line
    if chosen is None:
        return None, None
    matched = _SIGNATURE.match(chosen)
    if matched is None:
        return None, None
    spoken_on = normalize_spoken_on(chosen)
    rest = matched.group("rest")
    place = rest.split(",", 1)[1] if "," in rest else ""
    place = clean_title(place)[:MAX_PLACE_LENGTH]
    return spoken_on, place or None
