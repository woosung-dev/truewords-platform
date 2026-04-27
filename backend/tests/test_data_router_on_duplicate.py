"""ADR-30 follow-up: data_router의 hash 계산 + skip 강화 단위 테스트."""

from __future__ import annotations

import hashlib

from src.admin.data_router import _compute_content_hash


def test_compute_content_hash_is_sha256_of_utf8():
    text = "참부모님 말씀입니다."
    expected = hashlib.sha256(text.encode("utf-8")).hexdigest()
    assert _compute_content_hash(text) == expected
    assert len(_compute_content_hash(text)) == 64


def test_compute_content_hash_is_deterministic():
    assert _compute_content_hash("abc") == _compute_content_hash("abc")


def test_compute_content_hash_changes_with_content():
    """skip 모드 분기 정합성: 콘텐츠가 다르면 hash가 달라야 한다."""
    assert _compute_content_hash("내용 v1") != _compute_content_hash("내용 v2")


def test_compute_content_hash_handles_korean_nfc_nfd():
    """한국어 NFC/NFD 정규화 차이는 hash가 다르게 나오는 게 정상.

    파이프라인 상위에서 텍스트를 normalize 하지 않으므로, 같은 의미의
    NFC/NFD 텍스트는 hash도 다르다. 운영상 텍스트 추출이 일관되면 문제 없음.
    """
    import unicodedata

    text = "한글"
    nfc = unicodedata.normalize("NFC", text)
    nfd = unicodedata.normalize("NFD", text)
    if nfc != nfd:
        assert _compute_content_hash(nfc) != _compute_content_hash(nfd)
