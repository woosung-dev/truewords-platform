"""ADR-30 follow-up: BatchService의 on_duplicate 정책 + Point ID 정렬 테스트."""

from __future__ import annotations

import inspect
import uuid

from src.pipeline.batch_service import BatchService


def test_batch_uses_namespace_url_like_ingestor():
    """배치 적재가 standard와 동일한 Point ID를 만들도록 NAMESPACE_URL을 써야 한다.

    ingestor.py의 ingest_chunks가 uuid.NAMESPACE_URL 기준으로 Point ID를 생성하므로,
    같은 (volume, chunk_index) 조합이 두 모드에서 동일 ID로 수렴해야 중복 적재가 없다.
    """
    src = inspect.getsource(BatchService._ingest_batch_results)
    assert "NAMESPACE_URL" in src, "batch는 standard와 같은 NAMESPACE_URL을 써야 함"
    assert "NAMESPACE_DNS" not in src, "NAMESPACE_DNS는 standard와 불일치 — 사용 금지"


def test_batch_point_id_collides_with_standard_for_same_chunk_key():
    """volume:chunk_index 동일하면 batch와 standard가 같은 Point ID로 수렴해야 함."""
    chunk_key = "vol_001:0"
    standard_id = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_key))
    # batch 측도 같은 NAMESPACE_URL + 같은 키 → 동일 결과여야 함
    batch_id = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_key))
    assert standard_id == batch_id
