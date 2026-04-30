"""Volume(파일) 영구 삭제 API 단위/회귀 테스트.

전체 통합(메인 loop / Qdrant / Postgres)은 mock 비용이 커서 본 테스트는 다음 두 축으로 한정:
1. 스키마 / 시그니처 잠금 — VolumeDeleteResponse/Request, delete_volumes / delete_by_volume_key
2. 라우터 wiring 회귀 — 코드 분기가 살아있는지 inspect 기반.
"""

from __future__ import annotations

import inspect

from src.admin.data_router import (
    _delete_volume_artifacts,
    delete_volume,
    delete_volumes_bulk,
)
from src.datasource.qdrant_service import DataSourceQdrantService
from src.datasource.schemas import VolumeDeleteRequest, VolumeDeleteResponse
from src.pipeline.batch_repository import BatchJobRepository
from src.pipeline.ingestion_repository import IngestionJobRepository


# --- 스키마 ---


def test_volume_delete_response_defaults():
    r = VolumeDeleteResponse()
    assert r.deleted_volumes == []
    assert r.total_chunks_deleted == 0
    assert r.skipped == []


def test_volume_delete_request_requires_at_least_one():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        VolumeDeleteRequest(volumes=[])


# --- Qdrant service 시그니처 ---


def test_qdrant_service_has_delete_volumes_method():
    assert hasattr(DataSourceQdrantService, "delete_volumes")
    sig = inspect.signature(DataSourceQdrantService.delete_volumes)
    assert "volumes" in sig.parameters


def test_qdrant_delete_volumes_handles_nfc_and_nfd():
    """NFC/NFD 운영 데이터 혼재 대응 — search_terms에 두 형태가 모두 포함되는지 잠금."""
    src = inspect.getsource(DataSourceQdrantService.delete_volumes)
    assert 'unicodedata.normalize("NFC"' in src
    assert 'unicodedata.normalize("NFD"' in src
    # field_match_any (raw httpx, MatchAny 동등)로 두 형태 모두 매칭하는 패턴
    assert "field_match_any" in src


# --- Repository 시그니처 ---


def test_ingestion_repository_has_delete_by_volume_key():
    assert hasattr(IngestionJobRepository, "delete_by_volume_key")


def test_batch_repository_has_delete_by_volume_key():
    assert hasattr(BatchJobRepository, "delete_by_volume_key")


# --- 라우터 wiring 회귀 ---


def test_delete_volume_router_uses_helper_and_logs():
    """단건 라우터가 _delete_volume_artifacts를 호출하고 audit log를 남기는지 잠금."""
    src = inspect.getsource(delete_volume)
    assert "_delete_volume_artifacts" in src
    # 감사 로그 — admin 식별 정보 포함
    assert "logger.warning" in src
    assert "delete_volume" in src


def test_delete_volumes_bulk_router_collects_skipped_and_logs():
    """bulk 라우터가 per-volume try/except + 결과 집계 + audit log."""
    src = inspect.getsource(delete_volumes_bulk)
    assert "_delete_volume_artifacts" in src
    assert "skipped" in src
    assert "logger.warning" in src


def test_delete_volume_artifacts_orders_qdrant_then_db():
    """Codex P2 학습: Qdrant 먼저(검색 즉시 반영) → DB 순서로 일관성 보장."""
    src = inspect.getsource(_delete_volume_artifacts)
    qdrant_idx = src.find("qdrant_service.delete_volumes")
    ingestion_idx = src.find("ing_repo.delete_by_volume_key")
    batch_idx = src.find("batch_repo.delete_by_volume_key")
    assert qdrant_idx >= 0 and ingestion_idx >= 0 and batch_idx >= 0
    assert qdrant_idx < ingestion_idx, "Qdrant delete가 IngestionJob delete보다 먼저여야 함"
    assert qdrant_idx < batch_idx, "Qdrant delete가 BatchJob delete보다 먼저여야 함"
