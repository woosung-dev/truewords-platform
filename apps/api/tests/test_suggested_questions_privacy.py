"""추천 질문 집계는 훈독 사용자의 비공개 AI 질문을 읽지 않는다.

get_top_queries_for_bot 결과는 cron 이 LLM 에 넘기고, 생성된 추천 질문은 GET /chatbots 로 익명에게
공개된다. 훈독 계정(users)의 AI 질문 세션은 "내 계정에서만" 보이는 기록이라 집계에서 빠져야 한다.
"""

from __future__ import annotations

import sqlite3
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

from app.modules.chat.models import MessageRole, ResearchSession, SessionMessage
import app.modules.chatbot.models  # noqa: F401 — chatbot_configs 테이블 등록
from app.modules.chatbot.repository import ChatbotRepository
from app.modules.identity.models import User

# SQLModel 은 sqlite 에 UUID 를 32자 hex 로 저장한다. 원시 SQL 바인드도 같은 모양으로 맞춘다.
sqlite3.register_adapter(uuid.UUID, lambda u: u.hex)


@pytest.fixture
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[
                SQLModel.metadata.tables[name]
                for name in ("chatbot_configs", "research_sessions", "session_messages", "users")
            ],
        )
    s = AsyncSession(engine, expire_on_commit=False)
    try:
        yield s
    finally:
        await s.close()
        await engine.dispose()


async def _ask(session: AsyncSession, bot_id: uuid.UUID, user_id: uuid.UUID | None, text: str) -> None:
    rs = ResearchSession(user_id=user_id, chatbot_config_id=bot_id)
    session.add(rs)
    await session.flush()
    session.add(SessionMessage(session_id=rs.id, role=MessageRole.USER, content=text))
    await session.flush()


@pytest.mark.asyncio
async def test_top_queries_exclude_hoondok_user_sessions(session: AsyncSession) -> None:
    bot_id = uuid.uuid4()
    member = User(email="dummy@example.com", display_name="식구")
    session.add(member)
    await session.flush()

    await _ask(session, bot_id, member.id, "DUMMY-PRIVATE-Q")
    await _ask(session, bot_id, None, "익명 공개 질문")
    await session.commit()

    rows = await ChatbotRepository(session).get_top_queries_for_bot(bot_id)
    texts = [r["query_text"] for r in rows]
    assert "익명 공개 질문" in texts
    assert "DUMMY-PRIVATE-Q" not in texts
