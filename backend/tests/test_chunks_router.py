"""인용 원문보기 endpoint 테스트 (P0-B + B1 ACL).

PoC 정리 (2026-04-29) — P1-B 4중 메타 제거 후 단순 텍스트 응답 검증.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.chatbot.dependencies import get_chatbot_service
from src.datasource.chunks_router import chunks_router
from src.datasource.dependencies import get_qdrant_service
from src.datasource.schemas import SourceChunkDetail


def _runtime_with_sources(*sources: str):
    """SearchModeConfig.tiers[*].sources 만 mock — ACL 검증에 필요한 attr 만."""
    tier = SimpleNamespace(sources=list(sources))
    search = SimpleNamespace(tiers=[tier], weighted_sources=[])
    return SimpleNamespace(search=search)


def _make_app(
    qdrant_service: object,
    chatbot_runtime_config: object | None = None,
) -> FastAPI:
    app = FastAPI()
    app.include_router(chunks_router)
    app.dependency_overrides[get_qdrant_service] = lambda: qdrant_service

    chatbot_service = AsyncMock()
    chatbot_service.build_runtime_config = AsyncMock(return_value=chatbot_runtime_config)
    app.dependency_overrides[get_chatbot_service] = lambda: chatbot_service
    return app


@pytest.mark.asyncio
async def test_get_chunk_returns_detail_when_chatbot_allows_source() -> None:
    service = AsyncMock()
    service.get_chunk_detail = AsyncMock(
        return_value=SourceChunkDetail(
            chunk_id="abc-123",
            text="참사랑은 위함을 위함을 본질로 합니다.",
            volume="347권",
            sources=["A"],
        )
    )
    app = _make_app(service, _runtime_with_sources("A", "B"))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sources/chunks/abc-123?chatbot_id=cb1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["chunk_id"] == "abc-123"
    assert body["volume"] == "347권"
    assert body["text"].startswith("참사랑은")


@pytest.mark.asyncio
async def test_get_chunk_403_when_chatbot_lacks_source() -> None:
    """청크 source 가 chatbot 의 허용 source 밖이면 403."""
    service = AsyncMock()
    service.get_chunk_detail = AsyncMock(
        return_value=SourceChunkDetail(
            chunk_id="d-secret",
            text="비공개 자료",
            volume="999권",
            sources=["D"],  # chatbot 은 A, B 만 허용
        )
    )
    app = _make_app(service, _runtime_with_sources("A", "B"))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sources/chunks/d-secret?chatbot_id=cb-public")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_chunk_404_when_chatbot_missing() -> None:
    """chatbot_id 미존재 시 404 (qdrant 호출 전에 차단)."""
    service = AsyncMock()
    service.get_chunk_detail = AsyncMock(return_value=None)
    app = _make_app(service, None)  # chatbot 미존재
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sources/chunks/x?chatbot_id=missing")
    assert resp.status_code == 404
    # qdrant 호출은 발생하지 않아야 함 (chatbot 검증이 먼저)
    service.get_chunk_detail.assert_not_awaited()


@pytest.mark.asyncio
async def test_get_chunk_404_when_chunk_missing() -> None:
    service = AsyncMock()
    service.get_chunk_detail = AsyncMock(return_value=None)
    app = _make_app(service, _runtime_with_sources("A"))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sources/chunks/missing-id?chatbot_id=cb1")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_chunk_400_when_chatbot_id_missing() -> None:
    """chatbot_id 쿼리 파라미터 미지정 시 422 (FastAPI 자동 검증)."""
    service = AsyncMock()
    app = _make_app(service, _runtime_with_sources("A"))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sources/chunks/abc-123")
    assert resp.status_code == 422
