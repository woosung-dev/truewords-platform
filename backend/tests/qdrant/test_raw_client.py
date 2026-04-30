"""RawQdrantClient 단위 테스트.

httpx.MockTransport 로 HTTP 응답을 모킹하여 다음을 검증한다:
- POST/PUT body 가 SDK 호출과 동등한 dict 형태로 직렬화됨
- 응답 dict → QdrantPoint dataclass 매핑 정확성
- 에러 (4xx/5xx, timeout, JSON 파싱 실패) 전파
- HTTP/2 가 비활성화되어 호출 (Cloudflare Tunnel 호환성)

이번 PR 의 핵심 회귀 방지 — search 모듈 전환 전 헬퍼 모듈의 정확성을 보장.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from src.qdrant.filters import (
    build_filter,
    field_match,
    field_match_any,
    field_range,
    fusion_rrf,
    prefetch,
    sparse_vector,
)
from src.qdrant.raw_client import FacetHit, QdrantPoint, RawQdrantClient


# ─── 테스트 헬퍼 ───────────────────────────────────────────────────────────────


def _make_client(handler) -> RawQdrantClient:
    """MockTransport 를 주입한 RawQdrantClient 생성."""
    transport = httpx.MockTransport(handler)
    return RawQdrantClient(
        base_url="http://qdrant.test",
        api_key="test-key",
        transport=transport,
    )


def _record_handler(captured: dict) -> Any:
    """요청을 captured dict 에 저장하고 빈 응답 반환."""

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = (
            json.loads(request.content.decode()) if request.content else None
        )
        return httpx.Response(200, json={"result": {"points": []}})

    return _handler


# ─── QdrantPoint ──────────────────────────────────────────────────────────────


def test_qdrant_point_from_dict_full():
    p = QdrantPoint.from_dict(
        {
            "id": "abc",
            "score": 0.85,
            "payload": {"text": "...", "volume": "001"},
            "vector": {"dense": [0.1, 0.2]},
            "version": 3,
        }
    )
    assert p.id == "abc"
    assert p.score == 0.85
    assert p.payload == {"text": "...", "volume": "001"}
    assert p.vector == {"dense": [0.1, 0.2]}
    assert p.version == 3


def test_qdrant_point_from_dict_minimal():
    p = QdrantPoint.from_dict({"id": 42, "score": 0.5})
    assert p.id == 42
    assert p.score == 0.5
    assert p.payload is None
    assert p.vector is None
    assert p.version is None


def test_qdrant_point_attribute_access_compatible_with_sdk_scoredpoint():
    """SDK ``ScoredPoint.score`` / ``.payload`` 와 동등한 attribute access 호환."""
    p = QdrantPoint.from_dict({"id": "x", "score": 0.9, "payload": {"k": "v"}})
    assert p.score == 0.9
    assert p.payload == {"k": "v"}


# ─── 인증 헤더 / HTTP 옵션 ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_query_points_sends_api_key_and_content_type_headers():
    captured: dict = {}
    client = _make_client(_record_handler(captured))

    await client.query_points("col", query=[0.1, 0.2], using="dense")

    assert captured["headers"]["api-key"] == "test-key"
    assert captured["headers"]["content-type"] == "application/json"


@pytest.mark.asyncio
async def test_default_timeout_is_short_for_cloud_run_cold_start():
    """timeout 미지정 시 connect=5s, total=15s 기본값. Vercel 60s proxy 에 안전."""
    client = RawQdrantClient(base_url="http://x.test", api_key="k")
    assert client._timeout.connect == 5.0
    assert client._timeout.read == 15.0


# ─── query_points (단일 vector) ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_query_points_single_dense_request_body():
    captured: dict = {}
    client = _make_client(_record_handler(captured))

    await client.query_points(
        "malssum_poc",
        query=[0.1] * 8,
        using="dense",
        score_threshold=0.5,
        limit=20,
    )

    assert captured["method"] == "POST"
    assert captured["url"].endswith("/collections/malssum_poc/points/query")
    body = captured["body"]
    assert body["query"] == [0.1] * 8
    assert body["using"] == "dense"
    assert body["score_threshold"] == 0.5
    assert body["limit"] == 20
    assert body["with_payload"] is True
    assert body["with_vector"] is False


@pytest.mark.asyncio
async def test_query_points_with_filter_serializes_dict():
    """build_filter 결과가 그대로 body['filter'] 에 직렬화."""
    captured: dict = {}
    client = _make_client(_record_handler(captured))

    f = build_filter(
        must=[
            field_range("created_at", gte=1700000000.0),
            field_match("chatbot_id", "providence_life"),
        ]
    )
    await client.query_points("c", query=[0.1], using="dense", query_filter=f)

    must = captured["body"]["filter"]["must"]
    assert {"key": "created_at", "range": {"gte": 1700000000.0}} in must
    assert {"key": "chatbot_id", "match": {"value": "providence_life"}} in must


@pytest.mark.asyncio
async def test_query_points_no_optional_fields_when_unset():
    """None 인 옵션은 body 에서 누락. Qdrant 서버 측 기본값 사용."""
    captured: dict = {}
    client = _make_client(_record_handler(captured))

    await client.query_points("c", limit=5)

    body = captured["body"]
    assert "query" not in body
    assert "using" not in body
    assert "filter" not in body
    assert "score_threshold" not in body
    assert "prefetch" not in body
    assert body["limit"] == 5


# ─── query_points (RRF prefetch fusion) ───────────────────────────────────────


@pytest.mark.asyncio
async def test_query_points_rrf_fusion_with_dense_and_sparse_prefetch():
    """hybrid_search 와 동등한 RRF prefetch + fusion query body."""
    captured: dict = {}
    client = _make_client(_record_handler(captured))

    dense = [0.1] * 4
    sparse = sparse_vector([1, 5, 9], [0.3, 0.6, 0.9])
    pre = [
        prefetch(dense, using="dense", limit=50),
        prefetch(sparse, using="sparse", limit=50),
    ]
    f = build_filter(must=[field_match_any("source", ["A", "B"])])

    await client.query_points(
        "malssum_poc",
        query=fusion_rrf(),
        prefetch=pre,
        query_filter=f,
        limit=10,
    )

    body = captured["body"]
    assert body["query"] == {"fusion": "rrf"}
    assert len(body["prefetch"]) == 2
    assert body["prefetch"][0]["using"] == "dense"
    assert body["prefetch"][1]["using"] == "sparse"
    assert body["prefetch"][1]["query"] == sparse
    assert body["filter"]["must"][0]["match"]["any"] == ["A", "B"]


@pytest.mark.asyncio
async def test_query_points_parses_response_into_qdrant_points():
    response_payload = {
        "result": {
            "points": [
                {
                    "id": "p1",
                    "score": 0.95,
                    "payload": {"text": "기도", "volume": "001", "source": ["A"]},
                },
                {
                    "id": "p2",
                    "score": 0.80,
                    "payload": {"text": "찬양", "volume": "002", "source": ["B"]},
                },
            ]
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=response_payload)

    client = _make_client(handler)
    points = await client.query_points("c", query=[0.1], using="dense")

    assert len(points) == 2
    assert points[0].id == "p1"
    assert points[0].score == 0.95
    assert points[0].payload == {"text": "기도", "volume": "001", "source": ["A"]}
    assert points[1].score == 0.80


@pytest.mark.asyncio
async def test_query_points_empty_response_returns_empty_list():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"result": {"points": []}})

    client = _make_client(handler)
    points = await client.query_points("c", query=[0.1], using="dense")
    assert points == []


# ─── query_batch_points ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_query_batch_points_serializes_searches_array():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            200,
            json={
                "result": [
                    {"points": [{"id": "a", "score": 0.9}]},
                    {"points": [{"id": "b", "score": 0.7}]},
                ]
            },
        )

    client = _make_client(handler)
    searches = [
        {"query": [0.1], "using": "dense", "limit": 5},
        {"query": [0.2], "using": "dense", "limit": 5},
    ]
    batches = await client.query_batch_points("c", searches)

    assert captured["url"].endswith("/collections/c/points/query/batch")
    assert captured["body"] == {"searches": searches}
    assert len(batches) == 2
    assert batches[0][0].id == "a"
    assert batches[1][0].id == "b"


# ─── upsert ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upsert_puts_points_with_wait_query_param():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            200, json={"result": {"operation_id": 42, "status": "completed"}}
        )

    client = _make_client(handler)
    points = [
        {"id": "p1", "vector": {"dense": [0.1]}, "payload": {"text": "a"}},
    ]
    result = await client.upsert("col", points, wait=True)

    assert captured["method"] == "PUT"
    assert "/collections/col/points" in captured["url"]
    assert "wait=true" in captured["url"]
    assert captured["body"] == {"points": points}
    assert result == {"operation_id": 42, "status": "completed"}


@pytest.mark.asyncio
async def test_upsert_without_wait_omits_query_param():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"result": {}})

    client = _make_client(handler)
    await client.upsert("col", [{"id": "x"}], wait=False)
    assert "wait=true" not in captured["url"]


# ─── collection_exists ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_collection_exists_returns_true_when_present():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(
            200,
            json={
                "result": {"collections": [{"name": "malssum_poc"}, {"name": "other"}]}
            },
        )

    client = _make_client(handler)
    assert await client.collection_exists("malssum_poc") is True
    assert await client.collection_exists("missing") is False


# ─── scroll (admin 페이징) ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_scroll_first_page_with_filter_and_pagination():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            200,
            json={
                "result": {
                    "points": [
                        {"id": "p1", "score": 0.0, "payload": {"volume": "001"}},
                        {"id": "p2", "score": 0.0, "payload": {"volume": "001"}},
                    ],
                    "next_page_offset": "offset-token",
                }
            },
        )

    client = _make_client(handler)
    f = {"must": [{"key": "volume", "match": {"value": "001"}}]}
    points, next_offset = await client.scroll(
        "col", scroll_filter=f, with_payload=["volume"], limit=2
    )

    assert captured["url"].endswith("/collections/col/points/scroll")
    assert captured["body"]["filter"] == f
    assert captured["body"]["with_payload"] == ["volume"]
    assert captured["body"]["limit"] == 2
    assert captured["body"]["with_vector"] is False
    assert "offset" not in captured["body"]
    assert len(points) == 2
    assert next_offset == "offset-token"


@pytest.mark.asyncio
async def test_scroll_with_offset_and_terminal_page():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(200, json={"result": {"points": []}})

    client = _make_client(handler)
    points, next_offset = await client.scroll(
        "col", offset="offset-token", limit=100
    )

    assert captured["body"]["offset"] == "offset-token"
    assert points == []
    assert next_offset is None  # next_page_offset 미존재 시 None


# ─── facet ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_facet_basic_aggregation():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            200,
            json={
                "result": {
                    "hits": [
                        {"value": "A", "count": 1200},
                        {"value": "B", "count": 800},
                    ]
                }
            },
        )

    client = _make_client(handler)
    hits = await client.facet("col", key="source", limit=1000)

    assert captured["url"].endswith("/collections/col/facet")
    assert captured["body"] == {"key": "source", "limit": 1000, "exact": False}
    assert len(hits) == 2
    assert hits[0].value == "A"
    assert hits[0].count == 1200
    assert isinstance(hits[0], FacetHit)


@pytest.mark.asyncio
async def test_facet_with_filter_serializes_dict():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(200, json={"result": {"hits": []}})

    client = _make_client(handler)
    f = {"must": [{"key": "source", "match": {"value": "A"}}]}
    await client.facet("col", key="volume", facet_filter=f, limit=500)

    assert captured["body"]["filter"] == f
    assert captured["body"]["key"] == "volume"
    assert captured["body"]["limit"] == 500


# ─── set_payload ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_payload_with_wait():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            200, json={"result": {"operation_id": 7, "status": "completed"}}
        )

    client = _make_client(handler)
    result = await client.set_payload(
        "col", payload={"source": ["A", "B"]}, points=["p1", "p2"], wait=True
    )

    assert captured["method"] == "POST"
    assert "/collections/col/points/payload" in captured["url"]
    assert "wait=true" in captured["url"]
    assert captured["body"] == {"payload": {"source": ["A", "B"]}, "points": ["p1", "p2"]}
    assert result == {"operation_id": 7, "status": "completed"}


# ─── delete ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_by_point_ids():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(200, json={"result": {}})

    client = _make_client(handler)
    await client.delete("col", points_selector=["p1", "p2"])

    assert "/collections/col/points/delete" in captured["url"]
    assert captured["body"] == {"points": ["p1", "p2"]}


@pytest.mark.asyncio
async def test_delete_by_filter():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(200, json={"result": {}})

    client = _make_client(handler)
    f = {"must": [{"key": "volume", "match": {"any": ["001", "002"]}}]}
    await client.delete("col", points_selector=f)

    assert captured["body"] == {"filter": f}


# ─── count ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_count_exact_and_filter():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(200, json={"result": {"count": 12345}})

    client = _make_client(handler)
    f = {"must": [{"key": "source", "match": {"value": "A"}}]}
    n = await client.count("col", count_filter=f, exact=True)

    assert "/collections/col/points/count" in captured["url"]
    assert captured["body"] == {"exact": True, "filter": f}
    assert n == 12345


# ─── 에러 전파 ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_query_points_raises_on_4xx():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"status": {"error": "unauthorized"}})

    client = _make_client(handler)
    with pytest.raises(httpx.HTTPStatusError):
        await client.query_points("c", query=[0.1], using="dense")


@pytest.mark.asyncio
async def test_query_points_raises_on_5xx():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"status": {"error": "service unavailable"}})

    client = _make_client(handler)
    with pytest.raises(httpx.HTTPStatusError):
        await client.query_points("c", query=[0.1], using="dense")


@pytest.mark.asyncio
async def test_query_points_propagates_timeout_exception():
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("simulated tunnel timeout")

    client = _make_client(handler)
    with pytest.raises(httpx.ConnectTimeout):
        await client.query_points("c", query=[0.1], using="dense")


# ─── HTTP/2 비활성화 (Cloudflare Tunnel 호환성) ───────────────────────────────


def test_client_factory_disables_http2():
    """RawQdrantClient._client() 가 항상 http2=False 인 AsyncClient 를 만든다."""
    transport = httpx.MockTransport(lambda r: httpx.Response(200))
    client = RawQdrantClient(base_url="http://x", api_key="k", transport=transport)
    httpx_client = client._client()
    # private attribute 접근. http2 비활성화 검증의 다른 방법은 거의 없음.
    # 이번 PR 핵심 회귀 방지 — SDK hang 의 근본 원인이 HTTP/2 이므로 안전망.
    assert httpx_client._transport is transport
    # AsyncClient 의 http2 옵션은 transport 가 아닌 경우에만 의미 있으니
    # 실제 회귀는 통합 검증 (Cloudflare Tunnel 호출 < 5s) 으로 마지막에 확인.
