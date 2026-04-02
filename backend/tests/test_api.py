"""API 엔드포인트 비동기 테스트."""

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
