"""P1-C — popular_router endpoint 테스트.

httpx + ASGITransport 로 FastAPI 앱에 직접 요청해서 검증한다. ChatRepository
와 ChatbotService 는 dependency override 로 mock 주입.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.chat.dependencies import get_chat_repository
from src.chat.popular_router import admin_popular_router, router as popular_router
from src.chatbot.dependencies import get_chatbot_service


def _make_app(
    *,
    popular_rows: list[tuple[str, int]] | None = None,
    config_id: uuid.UUID | None = uuid.uuid4(),
    include_admin: bool = False,
) -> FastAPI:
    """popular_router 가 attach 된 최소 FastAPI 앱.

    - chat_repo.get_popular_questions 는 ``popular_rows`` 반환.
    - chatbot_service.get_config_id 는 ``config_id`` 반환 (None 이면 404 path).
    """
    app = FastAPI()
    app.include_router(popular_router)
    if include_admin:
        app.include_router(admin_popular_router)

    chat_repo = AsyncMock()
    chat_repo.get_popular_questions = AsyncMock(return_value=popular_rows or [])
    app.dependency_overrides[get_chat_repository] = lambda: chat_repo

    chatbot_service = AsyncMock()
    chatbot_service.get_config_id = AsyncMock(return_value=config_id)
    app.dependency_overrides[get_chatbot_service] = lambda: chatbot_service
    return app


@pytest.mark.asyncio
async def test_returns_popular_questions_default_period() -> None:
    """기본 period=7d, limit=10 으로 호출되며 list[{question,count}] 반환."""
    rows = [("질문 A", 12), ("질문 B", 5), ("질문 C", 1)]
    app = _make_app(popular_rows=rows)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/chatbot/cb1/popular-questions")
    assert resp.status_code == 200
    body = resp.json()
    assert body == [
        {"question": "질문 A", "count": 12},
        {"question": "질문 B", "count": 5},
        {"question": "질문 C", "count": 1},
    ]


@pytest.mark.asyncio
async def test_empty_result() -> None:
    """집계 결과가 없으면 빈 배열."""
    app = _make_app(popular_rows=[])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            "/api/chatbot/cb1/popular-questions?period=30d&limit=5"
        )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_invalid_period_returns_422() -> None:
    """Literal['7d','30d','all'] — 다른 값은 FastAPI 가 422 로 거부."""
    app = _make_app(popular_rows=[])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/chatbot/cb1/popular-questions?period=1y")
    # Literal 검증 실패 — pydantic v2 기본 422
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_period_all_requires_admin_returns_401() -> None:
    """period=all 은 비인증 endpoint 에서는 401 (admin endpoint 로 분기 유도)."""
    app = _make_app(popular_rows=[("Q", 1)])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/chatbot/cb1/popular-questions?period=all")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_chatbot_not_found_returns_404() -> None:
    app = _make_app(popular_rows=[], config_id=None)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/chatbot/missing/popular-questions")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_limit_out_of_range_returns_422() -> None:
    app = _make_app(popular_rows=[])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/chatbot/cb1/popular-questions?limit=999")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_repository_called_with_correct_args() -> None:
    """7d → period_days=7, 30d → 30, default limit=10."""
    app = _make_app(popular_rows=[])
    chat_repo = app.dependency_overrides[get_chat_repository]()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.get("/api/chatbot/cb1/popular-questions?period=30d&limit=5")
    chat_repo.get_popular_questions.assert_awaited_once()
    _, kwargs = chat_repo.get_popular_questions.call_args
    assert kwargs["period_days"] == 30
    assert kwargs["limit"] == 5
