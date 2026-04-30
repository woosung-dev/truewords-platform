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


def test_process_file_standard_wires_strategy_correctly():
    """_process_file_standard가 strategy 결과를 실제 IO 호출로 wiring해야 한다.

    Strategy 단위 테스트는 정책 자체를 검증, 이 테스트는 wiring(IO 호출) 회귀 잠금.
    """
    import inspect

    from src.admin.data_router import _process_file_standard

    src = inspect.getsource(_process_file_standard)
    # P1 wiring: strategy["needs_reset"] → raw httpx delete + start_chunk=0
    # (PR-E 이후 sync_client.delete → _sync_delete_by_filter (raw httpx HTTP/1.1))
    assert 'strategy["needs_reset"]' in src
    assert "_sync_delete_by_filter" in src
    assert "start_chunk = 0" in src
    # P2 wiring: skip 단축 시 complete_job(total_chunks=preserved_total)
    assert 'strategy["skip_short_circuit"]' in src
    assert "total_chunks=preserved_total" in src
    # 정상 적재 완료 후 total_chunks 명시
    assert "total_chunks=len(chunks)" in src
    # payload_sources는 strategy에서 가져와 ingest_chunks에 전달
    assert 'strategy["payload_sources"]' in src or "payload_sources = strategy" in src
    # _resolve_upload_strategy 호출 자체
    assert "_resolve_upload_strategy" in src


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


# ---------------------------------------------------------------------------
# Codex P1/P2 회귀: _resolve_upload_strategy 순수 함수 (mock 없는 단위 검증)
#
# 이 helper는 _process_file_standard의 분기 결정을 IO와 분리해 캡슐화한다.
# 모든 시나리오(skip/merge/replace × 신규/PARTIAL/COMPLETED × hash 일치/불일치)를
# 직접 검증하는 진짜 동작 회귀 잠금이다.
# ---------------------------------------------------------------------------


from src.admin.data_router import _resolve_upload_strategy


def _strategy(**overrides) -> dict:
    """기본 인자 + override 만으로 strategy 호출하는 헬퍼."""
    base = {
        "on_duplicate": "merge",
        "existing_status": None,
        "existing_processed_chunks": 0,
        "existing_total_chunks": 0,
        "existing_content_hash": None,
        "existing_chunk_count": 0,
        "existing_sources": [],
        "new_source": "",
        "new_hash": "h_new",
    }
    base.update(overrides)
    return _resolve_upload_strategy(**base)


# --- 신규 파일 (existing 없음) ---


def test_strategy_new_file_no_reset_no_short_circuit():
    s = _strategy(on_duplicate="merge", new_source="A")
    assert s["skip_short_circuit"] is False
    assert s["needs_reset"] is False
    # 신규 source는 union에 들어가 sorted=["A"]
    assert s["payload_sources"] == ["A"]


def test_strategy_new_file_replace_payload_sources_none():
    s = _strategy(on_duplicate="replace", new_source="A")
    assert s["needs_reset"] is False
    # replace는 chunk.source([source]) 그대로 사용 → None
    assert s["payload_sources"] is None


def test_strategy_new_file_skip_no_existing_runs_normal():
    """skip + 신규 → 단축 없음, payload_sources는 신규만."""
    s = _strategy(on_duplicate="skip", new_source="A")
    assert s["skip_short_circuit"] is False
    assert s["needs_reset"] is False
    assert s["payload_sources"] == ["A"]


# --- COMPLETED 재업로드 — P1 reset 보장 ---


def test_strategy_completed_merge_triggers_reset_and_union():
    """Codex P1: COMPLETED + merge → reset + 기존 ∪ 신규 union."""
    s = _strategy(
        on_duplicate="merge",
        existing_status="completed",
        existing_processed_chunks=10,
        existing_total_chunks=10,
        existing_content_hash="h_old",
        existing_chunk_count=10,
        existing_sources=["A"],
        new_source="B",
    )
    assert s["needs_reset"] is True
    assert s["skip_short_circuit"] is False
    assert s["payload_sources"] == ["A", "B"]


def test_strategy_completed_replace_resets_but_no_union():
    """COMPLETED + replace → reset, payload_sources None (chunk.source 사용)."""
    s = _strategy(
        on_duplicate="replace",
        existing_status="completed",
        existing_processed_chunks=10,
        existing_chunk_count=10,
        existing_sources=["A"],
        new_source="B",
        existing_content_hash="h_old",
    )
    assert s["needs_reset"] is True
    assert s["payload_sources"] is None


def test_strategy_merge_with_empty_new_source_keeps_existing():
    """미분류로 재업로드 — 기존 분류 보존(빈 source는 union에서 제외)."""
    s = _strategy(
        on_duplicate="merge",
        existing_status="completed",
        existing_processed_chunks=5,
        existing_chunk_count=5,
        existing_sources=["말씀선집"],
        new_source="",
        existing_content_hash="h_old",
    )
    assert s["needs_reset"] is True
    # 사용자 보고 시나리오: ["말씀선집"]만 보존, 빈 source 추가 안 됨
    assert s["payload_sources"] == ["말씀선집"]


# --- skip 단축 경로 (P2 total_chunks 보존) ---


def test_strategy_skip_short_circuits_when_hash_matches():
    """Codex P2: skip + COMPLETED + hash 일치 → 단축 + total_chunks 복구 정보."""
    s = _strategy(
        on_duplicate="skip",
        existing_status="completed",
        existing_processed_chunks=23,
        existing_total_chunks=25,
        existing_chunk_count=23,
        existing_content_hash="h_new",  # 일치
        existing_sources=["A"],
        new_source="B",
        new_hash="h_new",
    )
    assert s["skip_short_circuit"] is True
    assert s["needs_reset"] is False
    assert s["preserved_processed"] == 23
    assert s["preserved_total"] == 25


def test_strategy_skip_short_circuit_uses_processed_when_total_zero():
    """existing_total_chunks가 0이면 processed로 fallback (upsert_pending 리셋 후 복구)."""
    s = _strategy(
        on_duplicate="skip",
        existing_status="completed",
        existing_processed_chunks=12,
        existing_total_chunks=0,  # upsert_pending 리셋 직후
        existing_content_hash="h_new",
        existing_chunk_count=12,
        new_hash="h_new",
    )
    assert s["skip_short_circuit"] is True
    assert s["preserved_total"] == 12


def test_strategy_skip_falls_through_when_hash_mismatches():
    """skip + hash 불일치 → 단축 X, merge 정책으로 fallback (분류 보존)."""
    s = _strategy(
        on_duplicate="skip",
        existing_status="completed",
        existing_processed_chunks=10,
        existing_total_chunks=10,
        existing_chunk_count=10,
        existing_content_hash="h_old",  # 불일치
        existing_sources=["A"],
        new_source="B",
        new_hash="h_new",
    )
    assert s["skip_short_circuit"] is False
    assert s["needs_reset"] is True
    # skip fallback도 merge처럼 union
    assert s["payload_sources"] == ["A", "B"]


def test_strategy_skip_with_no_hash_falls_through():
    """이전에 hash 안 기록된 row(legacy)는 단축 안 함."""
    s = _strategy(
        on_duplicate="skip",
        existing_status="completed",
        existing_processed_chunks=10,
        existing_chunk_count=10,
        existing_content_hash=None,  # legacy
        existing_sources=["A"],
        new_source="A",
    )
    assert s["skip_short_circuit"] is False
    assert s["needs_reset"] is True


# --- PARTIAL/RUNNING 재개 (reset 안 함) ---


def test_strategy_partial_merge_no_reset_resumes():
    """PARTIAL + merge → reset 안 함, 이어서 적재. payload union 적용."""
    s = _strategy(
        on_duplicate="merge",
        existing_status="partial",
        existing_processed_chunks=5,
        existing_chunk_count=5,
        existing_sources=["A"],
        new_source="B",
    )
    assert s["needs_reset"] is False  # PARTIAL은 재개
    assert s["payload_sources"] == ["A", "B"]


def test_strategy_running_replace_no_reset():
    s = _strategy(
        on_duplicate="replace",
        existing_status="running",
        existing_processed_chunks=3,
        existing_chunk_count=3,
        existing_sources=["A"],
        new_source="B",
    )
    assert s["needs_reset"] is False
    assert s["payload_sources"] is None


# --- DB row 없고 Qdrant chunks만 (legacy 운영 데이터) ---


def test_strategy_qdrant_chunks_without_db_row_no_reset():
    """status=None + chunks > 0 → COMPLETED가 아니므로 reset X (안전 fallback)."""
    s = _strategy(
        on_duplicate="merge",
        existing_status=None,
        existing_chunk_count=8,
        existing_sources=["A"],
        new_source="B",
    )
    assert s["needs_reset"] is False
    # 그래도 union은 계산
    assert s["payload_sources"] == ["A", "B"]
