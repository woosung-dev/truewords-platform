"""Query Metadata Extractor — 질문에서 권/날짜/페이지 메타데이터 추출.

L1/L2 출처형 질문(예: "말씀선집 56권에서…", "1975년 9월 22일…")의 검색 정확도를
끌어올리기 위해 검색 전 단계에서 질문을 정규식으로 파싱하여 Qdrant filter
조건으로 변환한다.

추출 대상:
    - volume_num: 말씀선집 권번호 (1~999)
    - year/month/day: 날짜
    - page: 페이지 번호

필터 적용:
    - volume: pipeline/metadata.py:_extract_volume 결과 형식 ".zfill(3)" 사용 ("056").
              MatchValue exact match. PR #90 backfill 로 v5 컬렉션 일관 포맷 확보.
    - date: 11.5% 채워진 + 형식 이질적("1956년 10월 3일", "1956.10.3", "1956-10-3")
            → 본 PR 에서는 보류 (text index 추가 후 후속 PR)
    - page: payload 미저장 → 보류
"""

from __future__ import annotations

import re

from src.qdrant.filters import field_match

# 우선순위 높은 패턴부터 (말씀선집/제 prefix → 단독 N권)
_VOLUME_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"말씀선집\s*제?\s*(\d{1,3})\s*권"),
    re.compile(r"제\s*(\d{1,3})\s*권"),
    re.compile(r"(\d{1,3})\s*권"),
]

_DATE_FULL = re.compile(r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")
_DATE_YEAR = re.compile(r"(\d{4})\s*년")

_PAGE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"p\.?\s*(\d+)", re.IGNORECASE),
    re.compile(r"(\d+)\s*쪽"),
    re.compile(r"(\d+)\s*페이지"),
]


def extract_query_metadata(question: str) -> dict[str, int]:
    """질문에서 권/날짜/페이지 정수 메타데이터를 추출.

    Args:
        question: 사용자 질의 텍스트.

    Returns:
        추출된 키만 포함된 dict. 매칭 없으면 빈 dict.
        가능 키: ``volume_num``, ``year``, ``month``, ``day``, ``page`` (모두 int).
    """
    out: dict[str, int] = {}

    for pattern in _VOLUME_PATTERNS:
        if match := pattern.search(question):
            out["volume_num"] = int(match.group(1))
            break

    if match := _DATE_FULL.search(question):
        out["year"] = int(match.group(1))
        out["month"] = int(match.group(2))
        out["day"] = int(match.group(3))
    elif match := _DATE_YEAR.search(question):
        out["year"] = int(match.group(1))

    for pattern in _PAGE_PATTERNS:
        if match := pattern.search(question):
            out["page"] = int(match.group(1))
            break

    return out


def build_metadata_filter_conditions(meta: dict[str, int]) -> list[dict]:
    """추출된 메타데이터에서 Qdrant filter must 조건 리스트를 생성.

    현재는 ``volume`` 필터만 적용. payload 형식은
    ``backend/src/pipeline/metadata.py:_extract_volume`` 의 ``.zfill(3)`` 적용으로
    ``"001"``, ``"056"``, ``"123"`` 같은 zero-pad 3자리 숫자 형식이므로
    ``MatchValue`` exact match 로 거짓 양성("5" 입력 시 005/015/025... 매칭) 차단.

    Args:
        meta: ``extract_query_metadata`` 반환 dict.

    Returns:
        Qdrant filter ``must`` 배열에 그대로 합성 가능한 dict 조건 리스트.
        조건이 없으면 빈 리스트.
    """
    conditions: list[dict] = []

    if vol := meta.get("volume_num"):
        conditions.append(field_match("volume", str(vol).zfill(3)))

    return conditions
