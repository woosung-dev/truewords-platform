"""메타데이터 추출 + source 분류. 파일명/경로/텍스트에서 volume, title, date, source를 추출."""

import re
from pathlib import Path

# 권번호 패턴: "001권", "제123권", 숫자 3자리 등
_VOLUME_PATTERNS = [
    re.compile(r"(\d{1,3})권"),          # 001권, 123권
    re.compile(r"제(\d{1,3})권"),         # 제1권
    re.compile(r"^(\d{3})[^\d]"),         # 001_제목.pdf
]

# 날짜 패턴
_DATE_PATTERNS = [
    re.compile(r"\d{4}년\s*\d{1,2}월\s*\d{1,2}일"),   # 1956년 10월 3일
    re.compile(r"\d{4}\.\d{1,2}\.\d{1,2}"),             # 1956.10.3
    re.compile(r"\d{4}-\d{1,2}-\d{1,2}"),               # 1956-10-3
]

# source 분류 규칙: 폴더명 키워드 → source
_SOURCE_RULES = [
    (["원리강론", "3대경전"], "A"),
    (["자서전", "말씀선집"], "B"),
]


def extract_metadata(filepath: Path, text: str) -> dict:
    """파일명 + 텍스트에서 메타데이터 추출."""
    filename = filepath.stem

    volume = _extract_volume(filename)
    title = _extract_title(filename)
    date = _extract_date(text)

    return {"volume": volume, "title": title, "date": date}


def classify_source(filepath: Path) -> str:
    """폴더 경로 기반 source 분류 (A/B)."""
    path_str = str(filepath)
    for keywords, source in _SOURCE_RULES:
        if any(kw in path_str for kw in keywords):
            return source
    return "B"


def _extract_volume(filename: str) -> str:
    """파일명에서 권번호 추출."""
    for pattern in _VOLUME_PATTERNS:
        match = pattern.search(filename)
        if match:
            return match.group(1).zfill(3)
    return ""


def _extract_title(filename: str) -> str:
    """파일명에서 제목 추출. 권번호/확장자를 제거한 나머지."""
    # "원리강론 전편 - 제1장 창조원리 - 제1절 ..." → 그대로 제목으로 사용
    # "001권" 같은 순수 번호만 있으면 빈 문자열
    cleaned = re.sub(r"\d{1,3}권", "", filename).strip(" -_")
    # 숫자만 남았거나, 의미 없는 짧은 이름이면 제목 없음
    if re.fullmatch(r"\d*", cleaned) or len(cleaned) < 2:
        return ""
    # 한글/한자가 포함되지 않은 단순 영문 파일명은 제목으로 취급하지 않음
    if not re.search(r"[가-힣\u4e00-\u9fff]", cleaned):
        return ""
    return cleaned


def _extract_date(text: str) -> str:
    """텍스트 첫 500자에서 날짜 패턴 추출."""
    head = text[:500]
    for pattern in _DATE_PATTERNS:
        match = pattern.search(head)
        if match:
            return match.group(0)
    return ""
