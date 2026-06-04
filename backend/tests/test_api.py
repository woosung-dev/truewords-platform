"""API 엔드포인트 비동기 테스트."""

import httpx
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport

# DB 연결 없이 테스트하기 위해 lifespan의 init_db를 mock
with patch("main.init_db", new_callable=AsyncMock):
    from main import app


@pytest.fixture
def async_client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_health_endpoint(async_client):
    async with async_client as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_readyz_ready_when_qdrant_reachable(async_client):
    """Qdrant 도달 + main 컬렉션 존재 → 200 ready."""
    with patch("main.RawQdrantClient") as MockClient:
        MockClient.return_value.collection_exists = AsyncMock(return_value=True)
        async with async_client as client:
            response = await client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


@pytest.mark.asyncio
async def test_readyz_503_when_qdrant_unreachable(async_client):
    """Qdrant 터널 장애(연결 실패) → 503 unavailable. 내부 예외 repr 미노출."""
    with patch("main.RawQdrantClient") as MockClient:
        MockClient.return_value.collection_exists = AsyncMock(
            side_effect=httpx.ConnectError("tunnel down")
        )
        async with async_client as client:
            response = await client.get("/readyz")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unavailable"
    assert body["qdrant"] == "unreachable"
    assert "tunnel down" not in str(body)  # 내부 에러 상세는 로그로만


@pytest.mark.asyncio
async def test_readyz_503_when_collection_missing(async_client):
    """Qdrant 는 살아있으나 main 컬렉션 부재 → 503 collection_missing."""
    with patch("main.RawQdrantClient") as MockClient:
        MockClient.return_value.collection_exists = AsyncMock(return_value=False)
        async with async_client as client:
            response = await client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["qdrant"] == "collection_missing"
