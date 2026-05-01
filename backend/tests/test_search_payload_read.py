"""point_to_search_result 헬퍼 단위 테스트.

R3 PoC: Qdrant point.payload → SearchResult 변환이 v1 (QdrantChunkPayload)
및 v0 legacy 양쪽을 모두 처리하는지 검증. legacy adapter 분기가 자연 마이그레이션
(강제 재적재 0건) 을 보장.
"""
from __future__ import annotations

from types import SimpleNamespace

from src.search.hybrid import SearchResult, point_to_search_result


def _point(payload: dict, score: float = 0.5) -> SimpleNamespace:
    # P0-B 이후 ``point_to_search_result`` 가 ``str(point.id)`` 를
    # ``SearchResult.chunk_id`` 로 매핑하므로 mock 도 id 를 가져야 한다.
    return SimpleNamespace(payload=payload, score=score, id="test-chunk-id")


def test_v1_payload_with_all_fields():
    p = _point({
        "payload_version": 1,
        "text": "말씀",
        "volume": "001권",
        "chunk_index": 7,
        "source": ["A"],
        "title": "제목",
        "date": "2026",
    })
    r = point_to_search_result(p)
    assert isinstance(r, SearchResult)
    assert r.text == "말씀"
    assert r.volume == "001권"
    assert r.chunk_index == 7
    assert r.source == "A"
    assert r.score == 0.5


def test_v0_legacy_payload_without_payload_version():
    p = _point({
        "text": "legacy",
        "volume": "v0",
        "chunk_index": 3,
        "source": ["L"],
    })
    r = point_to_search_result(p)
    assert r.text == "legacy"
    assert r.chunk_index == 3
    assert r.source == "L"


def test_v0_legacy_payload_missing_chunk_index_falls_back_to_zero():
    """v0 의 chunk_index 누락 → ValidationError → legacy adapter 가 0 default."""
    p = _point({
        "text": "very-old",
        "volume": "v0",
        "source": ["L"],
    })
    r = point_to_search_result(p)
    assert r.text == "very-old"
    assert r.chunk_index == 0


def test_source_string_is_normalized():
    """source 가 list 가 아닌 단일 string 인 legacy payload 도 SearchResult.source 단일 문자열로."""
    p = _point({
        "text": "t", "volume": "v", "chunk_index": 0, "source": "B",
    })
    r = point_to_search_result(p)
    assert r.source == "B"


def test_empty_source_yields_empty_string():
    p = _point({
        "text": "t", "volume": "v", "chunk_index": 0, "source": [],
    })
    r = point_to_search_result(p)
    assert r.source == ""


def test_legacy_payload_with_extra_unknown_fields():
    """v1 model 의 extra='ignore' 가 알 수 없는 필드를 수용."""
    p = _point({
        "text": "t", "volume": "v", "chunk_index": 0, "source": ["A"],
        "future_field_x": "ignored", "another": 42,
    })
    r = point_to_search_result(p)
    assert r.text == "t"
