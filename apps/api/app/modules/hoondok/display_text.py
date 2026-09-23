"""훈독 원문 화면용 표시 텍스트 — Qdrant 청크 원본(`text`)을 읽기 좋게만 정리한다.

원본은 바꾸지 않는다(PLAN-HD-008). AI 설명·인용·검색은 계속 `text` 를 쓰고,
이 모듈의 결과는 화면 표시(`display_text`)에만 쓴다. 순수 함수이며 I/O 가 없다.

정리 순서:
1. 앞 청크와 겹치는 머리(~150자)를 `overlap_length` 로 잘라낸다.
2. 페이지 번호 줄(`- 2 -`)을 지운다.
3. 한 글자씩 띄운 한글(`머 리 말`)을 붙인다. 줄 전체면 제목으로 보고 문단을 나눈다.
4. PDF 줄바꿈을 합친다. 번호 항목·제목·짧은 줄(문단 끝·소제목) 앞뒤만 문단 경계다.
   80자보다 긴 줄이 있는 청크는 줄마다 문단인 TXT 로 보고 줄바꿈을 모두 문단 경계로 둔다.
5. 앞뒤 공백을 정리한다.

규칙은 천성경(PDF)·원리강론·평화경(TXT) 실데이터로 맞췄다 — 한계는 PLAN-HD-008 참고.
"""

from __future__ import annotations

import re

from app.modules.datasource.chunk_merge import normalize_for_merge, overlap_length

_PAGE_NUMBER = re.compile(r"^\s*-\s*\d+\s*-\s*$")
# 줄 전체가 한 글자씩 띄운 한글 3음절 이상 → 제목.
_SPACED_TITLE = re.compile(r"^[가-힣](?: [가-힣]){2,}$")
# 줄 일부에 섞인 경우는 연속 단음절 4개 이상일 때만 붙인다("그 때" 같은 본문 보호).
_SPACED_RUN = re.compile(r"(?<![가-힣])[가-힣](?: [가-힣]){3,}(?![가-힣])")
# 번호 항목 — "1. …", "(1) …", 천성경 절 번호 "3 인생에…". 인용 날짜 "02.12.27"·
# 성경 장절 "10 - 11절" 은 뒤따르는 글자 조건으로 제외된다.
_NUMBERED_ITEM = re.compile(r"^(?:\d{1,3}\.\s|\(\d{1,3}\)\s|\d{1,4} (?=[가-힣'‘\"“]))")
# 문장 끝 — 뒤따르는 각주 번호(원리강론 "것이다. 1")까지 허용한다.
_TERMINATED = re.compile(r"[.?!)\]」』”’\"']\s*\d{0,2}$")
# 줄 끝·줄 시작이 둘 다 이 글자면 단어 중간 줄바꿈으로 보고 공백 없이 붙인다.
_JOINABLE = re.compile(r"[가-힣一-鿿]")
# 닫는 괄호 뒤 조사("《…》을", "(…)에로")도 붙인다.
_CLOSER = re.compile(r"[)》」』]")
_NO_SPACE_BEFORE = re.compile(r"^[.,?!)\]」』”’:;]")

# 이보다 긴 줄은 PDF 줄바꿈이 아니다(실측 PDF 줄 폭 최대 63자) → 줄마다 문단인 TXT 로 본다.
_MAX_WRAP_WIDTH = 80
# 줄 폭 추정의 하한 — 목차처럼 짧은 줄만 있는 청크에서 폭이 과소 추정되지 않게 한다.
_MIN_WRAP_WIDTH = 45
# 폭 대비 이만큼 짧으면 문단 끝으로 본다. 문장 끝이면 느슨하게, 아니면(소제목) 엄격하게.
_SHORT_TERMINATED = 0.85
_SHORT_UNTERMINATED = 0.6


def _normalize(text: str) -> str:
    return normalize_for_merge(text).replace("﻿", "").replace("\xa0", " ")


def _collapse(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def _join_spaced(line: str) -> tuple[str, bool]:
    """띄운 한글을 붙인다. 두 번째 값은 줄 전체가 제목이었는지."""
    if _SPACED_TITLE.match(line):
        return line.replace(" ", ""), True
    return _SPACED_RUN.sub(lambda m: m.group(0).replace(" ", ""), line), False


def _wrap_width(lines: list[str]) -> int:
    lengths = sorted(len(line) for line in lines)
    if not lengths:
        return _MIN_WRAP_WIDTH
    return max(lengths[int(len(lengths) * 0.75)], _MIN_WRAP_WIDTH)


def _is_terminated_short(line: str, width: int) -> bool:
    return bool(_TERMINATED.search(line)) and len(line) < _SHORT_TERMINATED * width


def _is_short(line: str, width: int) -> bool:
    return _is_terminated_short(line, width) or len(line) < _SHORT_UNTERMINATED * width


def _glue(left: str, right: str, had_space: bool) -> str:
    if not had_space and (
        (
            (_JOINABLE.match(left[-1]) or _CLOSER.match(left[-1]))
            and _JOINABLE.match(right[0])
        )
        or _NO_SPACE_BEFORE.match(right)
    ):
        return left + right
    return f"{left} {right}"


def to_display_text(prev_text: str | None, text: str) -> str:
    """청크 원본을 화면 표시용 문단(`\\n\\n` 구분) 텍스트로 바꾼다."""
    current = _normalize(text)
    previous = _normalize(prev_text) if prev_text else ""
    cut = overlap_length(previous, current)
    current = current[cut:]
    # 겹침이 줄 중간에서 끝났으면 첫 줄은 조각이다 — 길이로 문단 끝을 판단하지 않는다.
    starts_mid_line = bool(cut) and not current.startswith("\n")

    # (접은 줄, 원래 줄 끝에 공백이 있었는지) — 빈 줄은 문단 경계(None).
    entries: list[tuple[str, bool] | None] = []
    for line in current.split("\n"):
        if _PAGE_NUMBER.match(line):
            continue
        collapsed = _collapse(line)
        entries.append((collapsed, line != line.rstrip()) if collapsed else None)

    lines = [entry[0] for entry in entries if entry is not None]
    is_per_line = any(len(line) > _MAX_WRAP_WIDTH for line in lines)
    # 폭은 앞 청크 줄까지 넣어 추정한다 — 짧은 청크 하나로 폭이 흔들리지 않게.
    width = _wrap_width(
        lines
        + [
            _collapse(line)
            for line in previous.split("\n")
            if _collapse(line) and not _PAGE_NUMBER.match(line)
        ]
    )

    paragraphs: list[str] = []
    buffer = ""
    had_space = False
    should_break = False
    is_first = True
    for entry in entries:
        if entry is None:
            if buffer:
                paragraphs.append(buffer)
            buffer = ""
            continue
        line, line_had_space = entry
        line, is_title = _join_spaced(line)
        if buffer and (
            is_per_line or should_break or is_title or _NUMBERED_ITEM.match(line)
        ):
            paragraphs.append(buffer)
            buffer = ""
        buffer = _glue(buffer, line, had_space) if buffer else line
        had_space = line_had_space
        if is_first and starts_mid_line:
            should_break = is_title or _is_terminated_short(line, width)
        else:
            should_break = is_title or _is_short(line, width)
        is_first = False
    if buffer:
        paragraphs.append(buffer)
    return "\n\n".join(paragraphs).strip()
