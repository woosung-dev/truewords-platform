"""메타데이터 추출 + source 분류 테스트."""

from pathlib import Path

from src.pipeline.metadata import extract_metadata, classify_source


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
    """원리강론 폴더 → source A."""
    assert classify_source(Path("/data/원리강론/원리강론/파일.txt")) == "A"


def test_classify_source_3dae():
    """3대경전 폴더 → source A."""
    assert classify_source(Path("/data/3대경전(증보판)/천성경.docx")) == "A"


def test_classify_source_jaseo():
    """참부모님 자서전 폴더 → source B."""
    assert classify_source(Path("/data/참부모님 자서전/자서전.txt")) == "B"


def test_classify_source_malssum():
    """말씀선집 폴더 → source B."""
    assert classify_source(Path("/data/문선명선생 말씀선집/001권.pdf")) == "B"


def test_classify_source_default():
    """알 수 없는 폴더 → 기본값 B."""
    assert classify_source(Path("/data/기타/파일.txt")) == "B"
