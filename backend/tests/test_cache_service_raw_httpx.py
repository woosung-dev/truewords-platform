"""SemanticCacheService raw httpx 호출 단위 테스트.

qdrant-client SDK 우회 후 모든 메서드가 Qdrant REST API를 정확한 형태로
호출하는지 확인. 응답 파싱·graceful degradation도 검증.

이번 PR 의 핵심 회귀 방지 — 다음 cold start 시점에 SDK hang 재발 없도록 보장.
"""

import time

import httpx
import pytest

from src.cache.service import SemanticCacheService


# ─── check_cache ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_check_cache_hits_returns_cache_hit(monkeypatch):
    """check_cache: 응답 points 비어있지 않으면 CacheHit 반환."""
    captured = {}

    async def mock_post(self, url, headers, json):  # noqa: ARG001
        captured["url"] = url
        captured["body"] = json
        captured["headers"] = headers

        class _R:
            status_code = 200

            def raise_for_status(self_inner):  # noqa: ARG001
                return None

            def json(self_inner):  # noqa: ARG001
                return {
                    "result": {
                        "points": [
                            {
                                "id": "abc",
                                "score": 0.97,
                                "payload": {
                                    "question": "기도란?",
                                    "answer": "기도는 ...",
                                    "sources": [],
                                    "created_at": time.time(),
                                },
                            }
                        ]
                    }
                }

        return _R()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    svc = SemanticCacheService()
    result = await svc.check_cache([0.1] * 1536, chatbot_id="cb1")

    assert result is not None
    assert result.question == "기도란?"
    assert result.score == 0.97
    # POST URL은 /collections/{name}/points/query
    assert captured["url"].endswith("/points/query")
    # body 형태
    assert captured["body"]["using"] == "dense"
    assert captured["body"]["score_threshold"] == svc.threshold
    assert captured["body"]["limit"] == 1
    # chatbot_id 필터 포함
    chatbot_filter = [c for c in captured["body"]["filter"]["must"]
                      if c.get("key") == "chatbot_id"]
    assert len(chatbot_filter) == 1


@pytest.mark.asyncio
async def test_check_cache_no_points_returns_none(monkeypatch):
    """check_cache: 빈 points → None 반환."""

    async def mock_post(self, url, headers, json):  # noqa: ARG001
        class _R:
            status_code = 200

            def raise_for_status(self_inner):  # noqa: ARG001
                return None

            def json(self_inner):  # noqa: ARG001
                return {"result": {"points": []}}

        return _R()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    svc = SemanticCacheService()
    result = await svc.check_cache([0.1] * 1536)
    assert result is None


@pytest.mark.asyncio
async def test_check_cache_http_error_returns_none(monkeypatch):
    """check_cache: HTTP 에러 → graceful miss (None 반환)."""

    async def mock_post(self, url, headers, json):  # noqa: ARG001
        raise httpx.ConnectError("simulated")

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    svc = SemanticCacheService()
    result = await svc.check_cache([0.1] * 1536)
    assert result is None


@pytest.mark.asyncio
async def test_check_cache_no_chatbot_id(monkeypatch):
    """check_cache: chatbot_id 미지정 시 created_at 필터만 포함."""
    captured = {}

    async def mock_post(self, url, headers, json):  # noqa: ARG001
        captured["body"] = json

        class _R:
            status_code = 200

            def raise_for_status(self_inner):  # noqa: ARG001
                return None

            def json(self_inner):  # noqa: ARG001
                return {"result": {"points": []}}

        return _R()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    svc = SemanticCacheService()
    await svc.check_cache([0.1] * 1536, chatbot_id=None)

    # must 에 created_at 만 있고 chatbot_id 없음
    keys = [c.get("key") for c in captured["body"]["filter"]["must"]]
    assert "created_at" in keys
    assert "chatbot_id" not in keys


# ─── store_cache ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_store_cache_puts_point(monkeypatch):
    """store_cache: PUT /collections/{name}/points 로 호출, point payload 정확."""
    captured = {}

    async def mock_put(self, url, headers, json):  # noqa: ARG001
        captured["url"] = url
        captured["body"] = json

        class _R:
            status_code = 200

            def raise_for_status(self_inner):  # noqa: ARG001
                return None

        return _R()

    monkeypatch.setattr(httpx.AsyncClient, "put", mock_put)

    svc = SemanticCacheService()
    await svc.store_cache(
        query="q", query_embedding=[0.1] * 1536,
        answer="a", sources=[], chatbot_id="cb1",
    )

    assert captured["url"].endswith(f"/collections/{svc.collection}/points")
    points = captured["body"]["points"]
    assert len(points) == 1
    point = points[0]
    assert point["vector"] == {"dense": [0.1] * 1536}
    assert point["payload"]["question"] == "q"
    assert point["payload"]["answer"] == "a"
    assert point["payload"]["chatbot_id"] == "cb1"


@pytest.mark.asyncio
async def test_store_cache_without_chatbot_id(monkeypatch):
    """store_cache: chatbot_id 미지정 시 payload.chatbot_id == '' 빈 문자열."""
    captured = {}

    async def mock_put(self, url, headers, json):  # noqa: ARG001
        captured["body"] = json

        class _R:
            status_code = 200

            def raise_for_status(self_inner):  # noqa: ARG001
                return None

        return _R()

    monkeypatch.setattr(httpx.AsyncClient, "put", mock_put)
    svc = SemanticCacheService()
    await svc.store_cache(
        query="q", query_embedding=[0.1] * 1536, answer="a", sources=[],
    )
    point = captured["body"]["points"][0]
    assert point["payload"]["chatbot_id"] == ""


@pytest.mark.asyncio
async def test_store_cache_swallows_errors(monkeypatch):
    """store_cache: 실패해도 예외 전파 X (RAG 응답 영향 없도록)."""

    async def mock_put(self, url, headers, json):  # noqa: ARG001
        raise httpx.ConnectError("simulated")

    monkeypatch.setattr(httpx.AsyncClient, "put", mock_put)
    svc = SemanticCacheService()
    # 예외 없이 그냥 종료되어야 함
    await svc.store_cache(
        query="q", query_embedding=[0.1] * 1536, answer="a", sources=[],
    )


# ─── invalidation 메타데이터 (R-cache-hardening) ────────────────────────────────


@pytest.mark.asyncio
async def test_check_cache_includes_embedding_model_filter(monkeypatch):
    """check_cache: embedding_model 필터가 항상 must 에 포함되어야 한다.

    임베딩 모델 변경 시 cache 가 호환되지 않으므로 자동 stale 처리 보장.
    """
    captured = {}

    async def mock_post(self, url, headers, json):  # noqa: ARG001
        captured["body"] = json

        class _R:
            status_code = 200

            def raise_for_status(self_inner):  # noqa: ARG001
                return None

            def json(self_inner):  # noqa: ARG001
                return {"result": {"points": []}}

        return _R()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    svc = SemanticCacheService()
    await svc.check_cache([0.1] * 1536, chatbot_id="cb1")

    must = captured["body"]["filter"]["must"]
    embedding_filter = [c for c in must if c.get("key") == "embedding_model"]
    assert len(embedding_filter) == 1
    assert embedding_filter[0]["match"]["value"] == svc.embedding_model


@pytest.mark.asyncio
async def test_check_cache_includes_corpus_filter_when_provided(monkeypatch):
    """check_cache: corpus_updated_at 인자 전달 시 must 필터 추가.

    cache 의 corpus_updated_at 이 인자보다 작으면 Qdrant 가 자동 miss 처리.
    """
    captured = {}

    async def mock_post(self, url, headers, json):  # noqa: ARG001
        captured["body"] = json

        class _R:
            status_code = 200

            def raise_for_status(self_inner):  # noqa: ARG001
                return None

            def json(self_inner):  # noqa: ARG001
                return {"result": {"points": []}}

        return _R()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    svc = SemanticCacheService()
    await svc.check_cache(
        [0.1] * 1536, chatbot_id="cb1", corpus_updated_at=1700000000.0
    )

    must = captured["body"]["filter"]["must"]
    corpus_filter = [c for c in must if c.get("key") == "corpus_updated_at"]
    assert len(corpus_filter) == 1
    assert corpus_filter[0]["range"]["gte"] == 1700000000.0


@pytest.mark.asyncio
async def test_check_cache_omits_corpus_filter_when_none(monkeypatch):
    """check_cache: corpus_updated_at=None 이면 corpus 필터 생략 (모두 valid)."""
    captured = {}

    async def mock_post(self, url, headers, json):  # noqa: ARG001
        captured["body"] = json

        class _R:
            status_code = 200

            def raise_for_status(self_inner):  # noqa: ARG001
                return None

            def json(self_inner):  # noqa: ARG001
                return {"result": {"points": []}}

        return _R()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    svc = SemanticCacheService()
    await svc.check_cache([0.1] * 1536, chatbot_id="cb1")

    must = captured["body"]["filter"]["must"]
    keys = [c.get("key") for c in must]
    assert "corpus_updated_at" not in keys


@pytest.mark.asyncio
async def test_store_cache_writes_invalidation_metadata(monkeypatch):
    """store_cache: payload 에 corpus_updated_at + embedding_model 포함.

    인자 미지정 시 corpus_updated_at=0.0 (legacy/테스트 호환), embedding_model 은
    service 의 self.embedding_model 사용.
    """
    captured = {}

    async def mock_put(self, url, headers, json):  # noqa: ARG001
        captured["body"] = json

        class _R:
            status_code = 200

            def raise_for_status(self_inner):  # noqa: ARG001
                return None

        return _R()

    monkeypatch.setattr(httpx.AsyncClient, "put", mock_put)
    svc = SemanticCacheService()

    # 1. corpus_updated_at 명시
    await svc.store_cache(
        query="q",
        query_embedding=[0.1] * 1536,
        answer="a",
        sources=[],
        chatbot_id="cb1",
        corpus_updated_at=1700000000.0,
    )
    payload = captured["body"]["points"][0]["payload"]
    assert payload["corpus_updated_at"] == 1700000000.0
    assert payload["embedding_model"] == svc.embedding_model

    # 2. corpus_updated_at 미지정 → 0.0 (이후 corpus 갱신 시 자동 stale)
    await svc.store_cache(
        query="q",
        query_embedding=[0.1] * 1536,
        answer="a",
        sources=[],
    )
    payload = captured["body"]["points"][0]["payload"]
    assert payload["corpus_updated_at"] == 0.0
    assert payload["embedding_model"] == svc.embedding_model
