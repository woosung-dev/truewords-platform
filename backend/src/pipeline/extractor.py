"""멀티포맷 텍스트 추출. PDF, DOCX, TXT 지원. HWP는 거부."""

from pathlib import Path

import pymupdf
from docx import Document


def extract_text(filepath: Path) -> str:
    """파일에서 텍스트를 추출. 확장자 기반 분기."""
    suffix = filepath.suffix.lower()

    if suffix == ".txt":
        return filepath.read_text(encoding="utf-8")

    if suffix == ".pdf":
        return _extract_pdf(filepath)

    if suffix == ".docx":
        return _extract_docx(filepath)

    if suffix in (".hwp", ".hwpx"):
        raise ValueError(
            f"HWP 파일은 직접 처리할 수 없습니다. "
            f"TXT로 변환 후 제공해주세요: {filepath.name}"
        )

    raise ValueError(f"지원하지 않는 파일 형식입니다: {suffix} ({filepath.name})")


def _extract_pdf(filepath: Path) -> str:
    """PDF에서 텍스트 추출 (pymupdf)."""
    pages = []
    with pymupdf.open(filepath) as doc:
        for page in doc:
            pages.append(page.get_text())
    return "\n".join(pages)


def _extract_docx(filepath: Path) -> str:
    """DOCX에서 텍스트 추출 (python-docx)."""
    doc = Document(filepath)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
