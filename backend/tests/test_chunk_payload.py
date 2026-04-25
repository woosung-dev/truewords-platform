"""QdrantChunkPayload Pydantic 모델 단위 테스트.

R3 PoC: 두 ingest 경로 (pipeline/ingestor.py, pipeline/batch_service.py) 가
동일 스키마로 Qdrant payload 를 만들고, 두 search 경로 (search/hybrid.py,
search/fallback.py) 가 동일 스키마로 읽도록 통일하는 단일 진실 원점 모델.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.pipeline.chunk_payload import QdrantChunkPayload


def test_required_fields_pass_validation():
    payload = QdrantChunkPayload(
        text="말씀 본문...",
        volume="001권",
        chunk_index=0,
        source=["A"],
    )
    assert payload.payload_version == 1
    assert payload.text == "말씀 본문..."
    assert payload.volume == "001권"
    assert payload.chunk_index == 0
    assert payload.source == ["A"]


def test_title_and_date_default_to_empty_string():
    payload = QdrantChunkPayload(
        text="t", volume="v", chunk_index=0, source=["A"],
    )
    assert payload.title == ""
    assert payload.date == ""


def test_extra_fields_are_ignored_for_legacy_compatibility():
    """v0 legacy payload 가 추가 필드를 가져도 v1 model_validate 는 통과."""
    payload = QdrantChunkPayload.model_validate({
        "text": "t",
        "volume": "v",
        "chunk_index": 0,
        "source": ["A"],
        "legacy_field_x": "ignored",
        "another_unknown": 42,
    })
    assert payload.text == "t"
    assert not hasattr(payload, "legacy_field_x")


def test_model_dump_contains_all_seven_keys():
    """ingest 측이 model_dump() 결과를 그대로 Qdrant 에 적재."""
    payload = QdrantChunkPayload(
        text="t", volume="v", chunk_index=3, source=["A", "B"],
        title="제목", date="2026-04-25",
    )
    dumped = payload.model_dump()
    assert set(dumped.keys()) == {
        "payload_version", "text", "volume", "chunk_index",
        "source", "title", "date",
    }
    assert dumped["payload_version"] == 1
    assert dumped["chunk_index"] == 3
    assert dumped["source"] == ["A", "B"]


def test_missing_required_field_raises_validation_error():
    with pytest.raises(ValidationError):
        QdrantChunkPayload(text="t", volume="v", chunk_index=0)  # type: ignore[call-arg]
