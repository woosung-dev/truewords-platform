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


# ---------------------------------------------------------------------------
# Codex P1/P2 회귀: _process_file_standard 의 reset 분기 + total_chunks 보존
# (전체 통합은 메인 loop/워커/Qdrant/AsyncSession 의존성이 무거워 mock 비용 큼.
#  대신 핵심 코드 분기가 코드에 남아있는지 inspect로 회귀 검사.)
# ---------------------------------------------------------------------------


def test_process_file_standard_has_completed_reupload_reset_branch():
    """COMPLETED 재업로드 시 Qdrant 청크 reset + start_chunk=0 분기가 살아있어야 한다."""
    import inspect

    from src.admin.data_router import _process_file_standard

    src = inspect.getsource(_process_file_standard)
    # P1 픽스: reset 분기 존재
    assert "needs_reset" in src, "needs_reset 분기 누락 — start_chunk no-op 회귀 위험"
    assert "sync_client.delete" in src
    assert "start_chunk = 0" in src
    # P2 픽스: skip 단축 경로에서 total_chunks 보존
    assert "total_chunks=preserved_total" in src
    # P2 픽스: 정상 적재 완료 후 total_chunks 명시
    assert "total_chunks=len(chunks)" in src
    # skip + hash 불일치는 merge와 동일 정책 (payload_sources 계산)
    assert 'on_duplicate in ("merge", "skip")' in src


def test_complete_job_accepts_total_chunks_kwarg():
    """skip 단축 경로 + 정상 완료 모두 total_chunks 키워드 인자로 복구 가능해야 함."""
    import inspect

    from src.pipeline.ingestion_repository import IngestionJobRepository

    sig = inspect.signature(IngestionJobRepository.complete_job)
    assert "total_chunks" in sig.parameters
    assert sig.parameters["total_chunks"].default is None
    assert sig.parameters["total_chunks"].kind == inspect.Parameter.KEYWORD_ONLY


def test_batch_service_ingest_results_uses_namespace_url():
    """ADR-30 follow-up — batch가 standard와 동일 NAMESPACE_URL이어야 한다 (Codex P2)."""
    import inspect

    from src.pipeline.batch_service import BatchService

    src = inspect.getsource(BatchService._ingest_batch_results)
    assert "NAMESPACE_URL" in src
    assert "NAMESPACE_DNS" not in src
