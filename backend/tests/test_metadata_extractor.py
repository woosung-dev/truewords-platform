"""Query Metadata Extractor 테스트.

질문에서 권/날짜/페이지를 정규식으로 추출하고,
Qdrant filter must 조건으로 변환하는 로직을 검증한다.
"""

from src.search.metadata_extractor import (
    build_metadata_filter_conditions,
    extract_query_metadata,
)


# --- extract_query_metadata: 권번호 ---


def test_extract_volume_malssum_prefix():
    """'말씀선집 56권' 패턴."""
    meta = extract_query_metadata("말씀선집 56권에서 축복가정에 대해 어떻게 말씀하셨나요?")
    assert meta == {"volume_num": 56}


def test_extract_volume_malssum_prefix_with_je():
    """'말씀선집 제56권' 패턴."""
    meta = extract_query_metadata("말씀선집 제56권 첫 장의 내용은?")
    assert meta == {"volume_num": 56}


def test_extract_volume_je_prefix():
    """'제56권' 패턴 (말씀선집 단어 없음)."""
    meta = extract_query_metadata("제56권에서 가정맹세 관련 말씀")
    assert meta == {"volume_num": 56}


def test_extract_volume_standalone():
    """단독 'N권' 패턴."""
    meta = extract_query_metadata("56권에서 알려주세요")
    assert meta == {"volume_num": 56}


def test_extract_volume_three_digit():
    """3자리 권번호."""
    meta = extract_query_metadata("말씀선집 200권 내용")
    assert meta == {"volume_num": 200}


def test_extract_volume_one_digit():
    """1자리 권번호 — payload zero-pad 와 매칭되도록 int 보존."""
    meta = extract_query_metadata("5권에서 알려주세요")
    assert meta == {"volume_num": 5}


def test_extract_volume_with_spaces():
    """공백 변형 허용."""
    meta = extract_query_metadata("말씀선집  제 56 권")
    assert meta == {"volume_num": 56}


def test_extract_volume_priority_malssum_first():
    """'말씀선집 56권 ... 100권' — 먼저 매칭된 명시 패턴이 우선."""
    meta = extract_query_metadata("말씀선집 56권에서 100권까지 비교")
    assert meta["volume_num"] == 56


# --- extract_query_metadata: 날짜 ---


def test_extract_date_full():
    """'YYYY년 MM월 DD일' 전체 패턴."""
    meta = extract_query_metadata("1975년 9월 22일 말씀")
    assert meta == {"year": 1975, "month": 9, "day": 22}


def test_extract_date_year_only():
    """연도만 추출."""
    meta = extract_query_metadata("1975년에 무슨 말씀을 하셨나요?")
    assert meta == {"year": 1975}


def test_extract_date_full_priority_over_year():
    """전체 날짜 패턴이 연도-only 패턴보다 우선."""
    meta = extract_query_metadata("1975년 9월 22일과 1980년 비교")
    assert meta == {"year": 1975, "month": 9, "day": 22}


# --- extract_query_metadata: 페이지 ---


def test_extract_page_p_prefix():
    """'p.123' 패턴."""
    meta = extract_query_metadata("p.123 의 내용")
    assert meta["page"] == 123


def test_extract_page_p_uppercase():
    """'P.123' 대문자 패턴."""
    meta = extract_query_metadata("P.123 내용")
    assert meta["page"] == 123


def test_extract_page_jjok():
    """'123쪽' 패턴."""
    meta = extract_query_metadata("123쪽에 어떤 말씀이?")
    assert meta["page"] == 123


def test_extract_page_korean():
    """'123페이지' 패턴."""
    meta = extract_query_metadata("123 페이지 인용해주세요")
    assert meta["page"] == 123


# --- extract_query_metadata: 복합 / 비명시 ---


def test_extract_combined():
    """권 + 날짜 + 페이지 동시 추출."""
    meta = extract_query_metadata("말씀선집 56권 1975년 9월 22일 p.123 내용")
    assert meta == {
        "volume_num": 56,
        "year": 1975,
        "month": 9,
        "day": 22,
        "page": 123,
    }


def test_extract_no_metadata_returns_empty():
    """메타데이터 없는 질문은 빈 dict."""
    meta = extract_query_metadata("축복가정의 의미는 무엇인가요?")
    assert meta == {}


def test_extract_empty_string():
    """빈 문자열은 빈 dict."""
    assert extract_query_metadata("") == {}


# --- build_metadata_filter_conditions ---


def test_build_filter_volume_zfill_two_digit():
    """volume_num 56 → '056' exact match (zfill 적용, _extract_volume 형식)."""
    conditions = build_metadata_filter_conditions({"volume_num": 56})
    assert conditions == [{"key": "volume", "match": {"value": "056"}}]


def test_build_filter_volume_zfill_one_digit():
    """volume_num 5 → '005' (거짓 양성 방지: '005' 만 매칭, '015/025/...' 제외)."""
    conditions = build_metadata_filter_conditions({"volume_num": 5})
    assert conditions == [{"key": "volume", "match": {"value": "005"}}]


def test_build_filter_volume_three_digit():
    """volume_num 200 → '200' (zfill 효과 없음)."""
    conditions = build_metadata_filter_conditions({"volume_num": 200})
    assert conditions == [{"key": "volume", "match": {"value": "200"}}]


def test_build_filter_empty_meta():
    """빈 dict → 빈 conditions."""
    assert build_metadata_filter_conditions({}) == []


def test_build_filter_only_volume_used_now():
    """현재는 volume 만 적용. year/month/day/page 는 보류 (date payload 11.5% 한계)."""
    conditions = build_metadata_filter_conditions(
        {"volume_num": 56, "year": 1975, "month": 9, "day": 22, "page": 123}
    )
    # volume 만 1개 condition 생성, _extract_volume 형식
    assert conditions == [{"key": "volume", "match": {"value": "056"}}]
