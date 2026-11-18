"""AI 요약 근거의 원문 범위(말씀 from–to)를 청크 원본에서 잘라낸다. 순수 함수이며 I/O 가 없다.

원문 청크는 PDF 글을 길이로 자른 조각이라 말씀 경계와 맞지 않는다. 근거의 `chunk_index` 는
"말씀 from 이 들어 있는 청크"로 저장됐지만 실데이터에서 한 칸 늦은 경우가 있어 호출자는 한 칸 앞부터 넘긴다.

천성경 원문은 말씀마다 줄 첫머리에 번호(`5 인간은…`)가 있고 끝에 출처 괄호(`(67-267, 73.7.22, p. 24)`)가 붙는다.
그래서 청크를 겹침 없이 이어 붙여 표시 텍스트로 정리한 뒤, from 번호 문단부터 to 보다 큰 번호 문단 직전까지 담고
마지막 출처 괄호에서 끝낸다. 번호가 없는 원문(평화경 — 문단 번호는 연설문 안 순번)은 자르지 못하고 None 이다.
"""

from __future__ import annotations

import re

from app.modules.datasource.chunk_merge import normalize_for_merge, overlap_length
from app.modules.hoondok.reading.display_text import to_display_text

# 말씀 끝 출처 — "(67-267, 73.7.22, p. 24)" · "(28-282, 70.2.11)"
_CITATION = re.compile(r"\(\d+-\d+,[^()]*\)")
# 문단 첫머리 말씀 번호. "27 3대 주체사상…" 처럼 숫자로 시작하는 본문도 있어 숫자를 허용한다.
_NUMBER = re.compile(r"^(\d{1,3}) (?=[가-힣'‘\"“\d])")


def join_chunks(texts: list[str]) -> str:
    """연속 청크 원본을 겹침을 지우고 잇는다. 겹침이 있으면 그 자리가 곧 이음새라 사이에 아무것도 넣지 않는다
    (단어 중간에서 끊긴 청크를 공백으로 벌리지 않게). 겹침이 없으면 PDF 줄바꿈처럼 이어 표시 규칙에 맡긴다."""
    merged = ""
    for text in texts:
        current = normalize_for_merge(text)
        if not merged:
            merged = current
            continue
        cut = overlap_length(merged, current)
        merged += current[cut:] if cut else "\n" + current
    return merged


def _split_after_citations(paragraph: str) -> list[str]:
    """출처 괄호 뒤에 붙은 다음 말씀·소제목을 떼어 낸다(표시 규칙이 숫자 시작 줄은 문단으로 나누지 않는다)."""
    pieces, start = [], 0
    for match in _CITATION.finditer(paragraph):
        if paragraph[match.end() :].strip():
            pieces.append(paragraph[start : match.end()].strip())
            start = match.end()
    pieces.append(paragraph[start:].strip())
    return [p for p in pieces if p]


def evidence_paragraphs(texts: list[str], start: int, end: int) -> list[str] | None:
    """말씀 start–end 의 표시 문단. 시작 번호를 못 찾거나 끝을 확인하지 못하면(청크 부족) None."""
    paragraphs = [
        piece
        for paragraph in to_display_text(None, join_chunks(texts)).split("\n\n")
        for piece in _split_after_citations(paragraph)
    ]
    picked: list[str] = []
    for paragraph in paragraphs:
        number = _NUMBER.match(paragraph)
        value = int(number.group(1)) if number else None
        if not picked:
            if value == start:
                picked.append(paragraph)
            continue
        # 다음 말씀(더 큰 번호) 또는 다음 절(번호가 1부터 다시 시작)에서 멈춘다
        if value is not None and (value > end or value < start):
            # 끝에 걸린 소제목처럼 출처 괄호로 끝나지 않는 문단은 버린다
            while picked and not picked[-1].endswith(")"):
                picked.pop()
            return picked or None
        picked.append(paragraph)
    return None
