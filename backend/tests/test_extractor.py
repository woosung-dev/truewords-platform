"""텍스트 추출 모듈 테스트."""

from pathlib import Path

import pytest
from unittest.mock import patch, MagicMock

from src.pipeline.extractor import extract_text


def test_extract_txt_reads_file(tmp_path: Path):
    """TXT 파일을 읽어서 텍스트를 반환."""
    txt_file = tmp_path / "test.txt"
    txt_file.write_text("하나님은 사랑이시다.", encoding="utf-8")
    result = extract_text(txt_file)
    assert result == "하나님은 사랑이시다."


def test_extract_pdf_returns_text(tmp_path: Path):
    """PDF 파일에서 텍스트 추출."""
    pdf_file = tmp_path / "test.pdf"
    pdf_file.touch()

    mock_doc = MagicMock()
    mock_page = MagicMock()
    mock_page.get_text.return_value = "PDF 본문 텍스트"
    mock_doc.__iter__ = lambda self: iter([mock_page])
    mock_doc.__enter__ = lambda self: self
    mock_doc.__exit__ = MagicMock(return_value=False)

    with patch("src.pipeline.extractor.pymupdf.open", return_value=mock_doc):
        result = extract_text(pdf_file)

    assert "PDF 본문 텍스트" in result


def test_extract_docx_returns_text(tmp_path: Path):
    """DOCX 파일에서 텍스트 추출."""
    docx_file = tmp_path / "test.docx"
    docx_file.touch()

    mock_doc = MagicMock()
    mock_para1 = MagicMock()
    mock_para1.text = "첫 번째 단락"
    mock_para2 = MagicMock()
    mock_para2.text = "두 번째 단락"
    mock_doc.paragraphs = [mock_para1, mock_para2]

    with patch("src.pipeline.extractor.Document", return_value=mock_doc):
        result = extract_text(docx_file)

    assert "첫 번째 단락" in result
    assert "두 번째 단락" in result


def test_extract_hwp_raises_error(tmp_path: Path):
    """HWP 파일은 거부하고 안내 메시지를 포함한 에러를 발생."""
    hwp_file = tmp_path / "test.hwp"
    hwp_file.touch()

    with pytest.raises(ValueError, match="TXT로 변환"):
        extract_text(hwp_file)


def test_extract_unknown_format_raises(tmp_path: Path):
    """미지원 형식은 에러 발생."""
    unknown_file = tmp_path / "test.xyz"
    unknown_file.touch()

    with pytest.raises(ValueError, match="지원하지 않는"):
        extract_text(unknown_file)
