"""메타데이터 추출 + source 분류 테스트."""

from pathlib import Path

from src.pipeline.metadata import (
    classify_book_series,
    classify_source,
    derive_volume,
    extract_metadata,
)


def test_extract_volume_from_filename():
    """파일명에서 권번호 추출."""
    meta = extract_metadata(Path("말씀선집/001권.pdf"), "본문")
    assert meta["volume"] == "001"


def test_extract_volume_from_filename_pattern2():
    """다양한 파일명 패턴에서 권번호 추출."""
    meta = extract_metadata(Path("말씀선집/말씀선집 123권.txt"), "본문")
    assert meta["volume"] == "123"


def test_extract_title_from_filename():
    """파일명에서 제목 추출."""
    meta = extract_metadata(
        Path("원리강론/원리강론 전편 - 제1장 창조원리 - 제1절 하나님의 이성성상.hwp"),
        "본문",
    )
    assert "창조원리" in meta["title"]


def test_extract_date_from_content():
    """텍스트 첫 부분에서 날짜 패턴 추출."""
    text = "1956년 10월 3일\n하나님의 섭리는..."
    meta = extract_metadata(Path("test.txt"), text)
    assert meta["date"] == "1956년 10월 3일"


def test_fallback_when_no_metadata():
    """메타데이터 없으면 빈 문자열."""
    meta = extract_metadata(Path("unknown.txt"), "본문만 있는 텍스트")
    assert meta["volume"] == ""
    assert meta["title"] == ""
    assert meta["date"] == ""


def test_classify_source_wonri():
    """원리강론 폴더 → key L."""
    assert classify_source(Path("/data/원리강론/원리강론/파일.txt")) == "L"


def test_classify_source_3dae():
    """3대경전 폴더 → key M."""
    assert classify_source(Path("/data/3대경전(증보판)/천성경.docx")) == "M"


def test_classify_source_3dae_via_chunk_filename():
    """파일명에 천성경/평화경 키워드 → key M (폴더 정보 부족 시)."""
    assert classify_source(Path("/data/random/천성경 (증보판).docx")) == "M"
    assert classify_source(Path("/data/random/평화경.txt")) == "M"


def test_classify_source_jaseo():
    """참부모님 자서전 폴더 → key N."""
    assert classify_source(Path("/data/참부모님 자서전/자서전.txt")) == "N"


def test_classify_source_malssum_father():
    """문선명선생 말씀선집 폴더 → key O."""
    assert classify_source(Path("/data/문선명선생 말씀선집/001권.pdf")) == "O"


def test_classify_source_mother_anthology():
    """참어머님말씀 폴더 → key B (어머니말씀)."""
    assert classify_source(Path("/data/참어머님말씀/001권.pdf")) == "B"


def test_classify_source_chambumo_theology():
    """참부모론 → key P."""
    assert classify_source(Path("/data/참부모론_한민족선민대서사시/01.txt")) == "P"


def test_classify_source_unification():
    """통일사상요강 → key Q."""
    assert classify_source(Path("/data/통일사상요강/통일사상요강(한글판).pdf")) == "Q"


def test_classify_source_default_empty():
    """알 수 없는 폴더 → 빈 문자열 (이전: B fallback)."""
    assert classify_source(Path("/data/기타/파일.txt")) == ""


# --- classify_book_series ---


def test_classify_book_series_mother():
    """참어머님말씀 → mother_anthology."""
    assert classify_book_series(Path("/data/참어머님말씀/001권.pdf")) == "mother_anthology"


def test_classify_book_series_father():
    """문선명선생 말씀선집 → father_anthology."""
    assert classify_book_series(Path("/data/문선명선생 말씀선집/001권.pdf")) == "father_anthology"


def test_classify_book_series_specific_books():
    """천성경/평화경/원리강론 등 단일 책."""
    assert classify_book_series(Path("/data/3대경전(증보판)/천성경.docx")) == "cheonseong_gyeong"
    assert classify_book_series(Path("/data/3대경전(증보판)/평화경.txt")) == "pyeonghwa_gyeong"
    assert classify_book_series(Path("/data/원리강론/원리강론.txt")) == "wonri_gangron"
    assert classify_book_series(Path("/data/통일사상요강/통일사상요강.pdf")) == "tongil_thought"


def test_classify_book_series_default_empty():
    """매칭 실패 시 빈 문자열."""
    assert classify_book_series(Path("/data/기타/파일.txt")) == ""


# --- derive_volume: Batch + Standard 적재 공용 헬퍼 ---


def test_derive_volume_with_extension_extracted():
    """확장자 포함 파일명에서 권번호 추출 (Batch 모드 시나리오)."""
    assert derive_volume("말씀선집 056권.pdf") == "056"


def test_derive_volume_one_digit():
    """1자리 권번호도 zfill(3) 적용."""
    assert derive_volume("말씀선집 002권.pdf") == "002"


def test_derive_volume_three_digit():
    """3자리 권번호."""
    assert derive_volume("말씀선집 200권.pdf") == "200"


def test_derive_volume_je_prefix():
    """제N권 패턴."""
    assert derive_volume("제1권.pdf") == "001"


def test_derive_volume_underscore_separator():
    """다양한 separator (참어머님 말씀정선집_2권 ...)."""
    assert derive_volume("참어머님 말씀정선집_2권 2000-2012_Final End.pdf") == "002"


def test_derive_volume_no_match_fallback_to_filename():
    """권번호 패턴 매칭 실패 시 volume_key 자체를 fallback (천성경/평화경 등)."""
    assert derive_volume("천성경 (증보판).docx") == "천성경 (증보판).docx"


def test_derive_volume_pure_volume_filename_three_digit_start():
    """파일명이 3자리 숫자로 시작하는 경우 (207 권.txt) — 패턴 3 매칭."""
    # ^(\d{3})[^\d] 패턴이 "207 " 매칭 → "207" 반환
    assert derive_volume("207 권.txt") == "207"


def test_derive_volume_idempotent_on_extracted_value():
    """이미 추출된 zfill 결과를 다시 derive 해도 안전 (backfill 멱등성)."""
    # _extract_volume("056") 은 패턴 매칭 안 됨 (권 없음) → fallback "056"
    assert derive_volume("056") == "056"
