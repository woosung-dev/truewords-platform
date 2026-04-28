"""인용 원문보기 endpoint 테스트 (P0-B)."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.datasource.chunks_router import chunks_router
from src.datasource.dependencies import get_qdrant_service
from src.datasource.schemas import SourceChunkDetail


def _make_app(service: object) -> FastAPI:
    app = FastAPI()
    app.include_router(chunks_router)
    app.dependency_overrides[get_qdrant_service] = lambda: service
    return app


@pytest.mark.asyncio
async def test_get_chunk_returns_detail() -> None:
    service = AsyncMock()
    service.get_chunk_detail = AsyncMock(
        return_value=SourceChunkDetail(
            chunk_id="abc-123",
            text="참사랑은 위함을 위함을 본질로 합니다.",
            volume="347권",
            sources=["A"],
            citation_label="[347권 · 2001.07.03 · 청평수련소 · 참사랑의 길]",
            volume_no=347,
            delivered_at="2001.07.03",
            delivered_place="청평수련소",
            chapter_title="참사랑의 길",
        )
    )
    app = _make_app(service)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sources/chunks/abc-123")
    assert resp.status_code == 200
    body = resp.json()
    assert body["chunk_id"] == "abc-123"
    assert body["volume_no"] == 347
    assert body["citation_label"] == "[347권 · 2001.07.03 · 청평수련소 · 참사랑의 길]"
    service.get_chunk_detail.assert_awaited_once_with("abc-123")


@pytest.mark.asyncio
async def test_get_chunk_404_when_missing() -> None:
    service = AsyncMock()
    service.get_chunk_detail = AsyncMock(return_value=None)
    app = _make_app(service)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sources/chunks/missing-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_chunk_with_partial_meta() -> None:
    """일부 메타가 없어도 응답에 None 으로 포함."""
    service = AsyncMock()
    service.get_chunk_detail = AsyncMock(
        return_value=SourceChunkDetail(
            chunk_id="x",
            text="...",
            volume="180권",
            sources=[],
            citation_label="[180권]",
            volume_no=180,
        )
    )
    app = _make_app(service)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sources/chunks/x")
    assert resp.status_code == 200
    body = resp.json()
    assert body["volume_no"] == 180
    assert body["delivered_at"] is None
    assert body["delivered_place"] is None
