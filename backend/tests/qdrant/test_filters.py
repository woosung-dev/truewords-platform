"""qdrant.filters 단위 테스트.

SDK 객체 (Filter / FieldCondition / MatchAny / Range / SparseVector / Prefetch /
FusionQuery) 와 동등한 dict 가 생성되는지 검증.
"""

from src.qdrant.filters import (
    build_filter,
    field_match,
    field_match_any,
    field_range,
    fusion_dbsf,
    fusion_rrf,
    prefetch,
    sparse_vector,
)


# ─── field_match ─────────────────────────────────────────────────────────────


def test_field_match_string_value():
    assert field_match("source", "A") == {"key": "source", "match": {"value": "A"}}


def test_field_match_int_value():
    assert field_match("chunk_index", 7) == {
        "key": "chunk_index",
        "match": {"value": 7},
    }


# ─── field_match_any ─────────────────────────────────────────────────────────


def test_field_match_any_multiple_values():
    assert field_match_any("source", ["A", "B"]) == {
        "key": "source",
        "match": {"any": ["A", "B"]},
    }


def test_field_match_any_empty_list():
    assert field_match_any("source", []) == {"key": "source", "match": {"any": []}}


# ─── field_range ─────────────────────────────────────────────────────────────


def test_field_range_gte_only():
    assert field_range("created_at", gte=1700000000.0) == {
        "key": "created_at",
        "range": {"gte": 1700000000.0},
    }


def test_field_range_full():
    result = field_range("score", gt=0.0, gte=0.1, lt=1.0, lte=0.9)
    assert result == {
        "key": "score",
        "range": {"gt": 0.0, "gte": 0.1, "lt": 1.0, "lte": 0.9},
    }


def test_field_range_no_bounds_returns_empty_range():
    assert field_range("created_at") == {"key": "created_at", "range": {}}


# ─── build_filter ────────────────────────────────────────────────────────────


def test_build_filter_must_only():
    must = [field_match("source", "A")]
    assert build_filter(must=must) == {"must": must}


def test_build_filter_must_and_must_not():
    must = [field_match("source", "A")]
    must_not = [field_match("source", "X")]
    assert build_filter(must=must, must_not=must_not) == {
        "must": must,
        "must_not": must_not,
    }


def test_build_filter_returns_none_when_empty():
    assert build_filter() is None
    assert build_filter(must=[], must_not=[], should=[]) is None


def test_build_filter_should_clause():
    should = [field_match("source", "A"), field_match("source", "B")]
    assert build_filter(should=should) == {"should": should}


# ─── sparse_vector ───────────────────────────────────────────────────────────


def test_sparse_vector_round_trip():
    indices = [10, 200, 3000]
    values = [0.1, 0.5, 0.9]
    assert sparse_vector(indices, values) == {"indices": indices, "values": values}


# ─── prefetch ────────────────────────────────────────────────────────────────


def test_prefetch_basic_dense():
    result = prefetch([0.1, 0.2, 0.3], using="dense", limit=50)
    assert result == {"query": [0.1, 0.2, 0.3], "using": "dense", "limit": 50}


def test_prefetch_sparse_with_filter():
    sv = sparse_vector([1, 2], [0.5, 0.7])
    f = build_filter(must=[field_match("source", "A")])
    result = prefetch(sv, using="sparse", limit=50, filter_=f)
    assert result == {"query": sv, "using": "sparse", "limit": 50, "filter": f}


def test_prefetch_no_filter_omits_field():
    result = prefetch([0.1], using="dense", limit=10)
    assert "filter" not in result


# ─── fusion ──────────────────────────────────────────────────────────────────


def test_fusion_rrf_dict():
    assert fusion_rrf() == {"fusion": "rrf"}


def test_fusion_dbsf_dict():
    assert fusion_dbsf() == {"fusion": "dbsf"}
