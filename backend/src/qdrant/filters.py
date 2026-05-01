"""Qdrant REST API 용 dict 헬퍼.

qdrant-client SDK 의 ``Filter``/``FieldCondition``/``MatchAny``/``SparseVector``/
``Prefetch``/``FusionQuery`` 객체를 raw HTTP body 의 dict 로 직접 변환하는 유틸.
사용처는 ``backend/src/qdrant/raw_client.py`` 와 search/cache 모듈.
"""

from typing import Any


def field_match(key: str, value: Any) -> dict:
    """단일 값 일치 조건. SDK ``FieldCondition(key=, match=MatchValue(value=))`` 동등."""
    return {"key": key, "match": {"value": value}}


def field_match_any(key: str, values: list[Any]) -> dict:
    """다중 값 OR 조건. SDK ``FieldCondition(key=, match=MatchAny(any=))`` 동등."""
    return {"key": key, "match": {"any": values}}


def field_range(
    key: str,
    *,
    gt: float | None = None,
    gte: float | None = None,
    lt: float | None = None,
    lte: float | None = None,
) -> dict:
    """범위 조건. SDK ``FieldCondition(key=, range=Range(...))`` 동등."""
    rng: dict[str, float] = {}
    if gt is not None:
        rng["gt"] = gt
    if gte is not None:
        rng["gte"] = gte
    if lt is not None:
        rng["lt"] = lt
    if lte is not None:
        rng["lte"] = lte
    return {"key": key, "range": rng}


def build_filter(
    *,
    must: list[dict] | None = None,
    must_not: list[dict] | None = None,
    should: list[dict] | None = None,
) -> dict | None:
    """SDK ``Filter(must=, must_not=, should=)`` 동등 dict. 모든 인자가 비면 ``None`` 반환."""
    f: dict[str, list[dict]] = {}
    if must:
        f["must"] = must
    if must_not:
        f["must_not"] = must_not
    if should:
        f["should"] = should
    return f or None


def sparse_vector(indices: list[int], values: list[float]) -> dict:
    """SDK ``SparseVector(indices=, values=)`` 동등 dict."""
    return {"indices": indices, "values": values}


def prefetch(
    query: list[float] | dict,
    *,
    using: str,
    limit: int,
    filter_: dict | None = None,
) -> dict:
    """SDK ``Prefetch(query=, using=, limit=, filter=)`` 동등 dict."""
    p: dict = {"query": query, "using": using, "limit": limit}
    if filter_ is not None:
        p["filter"] = filter_
    return p


def fusion_rrf() -> dict:
    """SDK ``FusionQuery(fusion=Fusion.RRF)`` 동등. RRF(Reciprocal Rank Fusion) 사용."""
    return {"fusion": "rrf"}


def fusion_dbsf() -> dict:
    """SDK ``FusionQuery(fusion=Fusion.DBSF)`` 동등. DBSF(Distribution-Based Score Fusion)."""
    return {"fusion": "dbsf"}
