"""인증 없는 답변 피드백 쓰기 상한 — 코멘트 길이와 IP 당 요청 빈도.

POST /chat/feedback 은 로그인 없이 tw_anon_session 쿠키만으로 행을 만든다. 쿠키를 빼거나 바꾸면
매번 새 행이 생기므로, 행 수와 코멘트 크기를 서버가 묶어야 한다.
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

from app.core.common.exception_handlers import rate_limit_handler
from app.modules.chat.dependencies import get_chat_service
from app.modules.chat.models import FeedbackType
from app.modules.chat.repository import ChatRepository
from app.modules.chat.router import router
from app.modules.chat.schemas import FeedbackRequest
from app.modules.chat.service import ChatService
from app.modules.safety.exceptions import RateLimitExceededError
from app.modules.safety.middleware import feedback_limiter


def test_comment_length_is_bounded() -> None:
    with pytest.raises(ValidationError):
        FeedbackRequest(message_id=uuid.uuid4(), feedback_type=FeedbackType.HELPFUL, comment="가" * 1001)
    assert FeedbackRequest(message_id=uuid.uuid4(), feedback_type=FeedbackType.HELPFUL, comment="가" * 1000)


@pytest.fixture
async def client():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[SQLModel.metadata.tables["answer_feedback"]])
    session = AsyncSession(engine, expire_on_commit=False)
    app = FastAPI()
    app.include_router(router)
    app.add_exception_handler(RateLimitExceededError, rate_limit_handler)  # type: ignore[arg-type]
    app.dependency_overrides[get_chat_service] = lambda: ChatService(
        chat_repo=ChatRepository(session), chatbot_service=MagicMock()
    )
    try:
        yield TestClient(app)
    finally:
        await session.close()
        await engine.dispose()


def test_anonymous_feedback_writes_are_rate_limited_per_ip(client: TestClient) -> None:
    """쿠키 없이 반복 제출해도 IP 당 상한을 넘으면 429 — 무한 행 생성을 막는다."""
    statuses = []
    for _ in range(feedback_limiter.max_requests + 1):
        client.cookies.clear()
        body = {"message_id": str(uuid.uuid4()), "feedback_type": "helpful"}
        statuses.append(client.post("/chat/feedback", json=body).status_code)
    assert statuses[: feedback_limiter.max_requests] == [201] * feedback_limiter.max_requests
    assert statuses[-1] == 429
