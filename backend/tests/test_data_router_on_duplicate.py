"""ADR-30 follow-up: data_router의 hash 계산 + skip 강화 단위 테스트."""

from __future__ import annotations

import hashlib

from src.admin.data_router import _compute_content_hash, _predict_outcome


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


# ---------------------------------------------------------------------------
# _predict_outcome — 사전 outcome 예측 (UploadResponse.predicted_outcome)
# ---------------------------------------------------------------------------


def test_predict_outcome_new_when_no_existing_data():
    assert _predict_outcome("merge", existing_status=None, existing_chunk_count=0) == "new"
    assert _predict_outcome("replace", existing_status=None, existing_chunk_count=0) == "new"
    assert _predict_outcome("skip", existing_status=None, existing_chunk_count=0) == "new"


def test_predict_outcome_skip_with_completed():
    """skip + COMPLETED → 'skip' (실제 hash 비교는 처리 시점)."""
    assert _predict_outcome("skip", existing_status="completed", existing_chunk_count=10) == "skip"


def test_predict_outcome_skip_with_pending_or_partial_falls_back_to_merge():
    """skip + 미완료 상태는 이어서 적재 의도라 merge로 표시."""
    assert _predict_outcome("skip", existing_status="pending", existing_chunk_count=0) == "merge"
    assert _predict_outcome("skip", existing_status="partial", existing_chunk_count=5) == "merge"


def test_predict_outcome_replace_when_data_exists():
    assert _predict_outcome("replace", existing_status="completed", existing_chunk_count=10) == "replace"


def test_predict_outcome_merge_when_data_exists():
    assert _predict_outcome("merge", existing_status="completed", existing_chunk_count=10) == "merge"


def test_predict_outcome_qdrant_only_no_db():
    """DB row는 없지만 Qdrant에 청크만 있는 경우도 exists로 간주."""
    assert _predict_outcome("merge", existing_status=None, existing_chunk_count=10) == "merge"
