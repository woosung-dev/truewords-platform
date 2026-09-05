"""AnswerFeedback current-state upsert 통합 테스트.

방향 A — (message_id, user_session_id) 당 현재 상태 1행. 좋아요→취소→좋아요→싫어요
반복 후에도 row 는 정확히 1개(또는 0개)여야 하며, 좋아요↔싫어요 전환은 append 가
아니라 UPDATE(교체)여야 한다. unique 제약이 실제 중복 INSERT 를 막는지도 검증.

실 DB(in-memory aiosqlite + StaticPool)로 unique 제약·INSERT/UPDATE/DELETE 를 그대로
검증한다. ChatService.upsert_feedback/delete_feedback 는 self.chat_repo 만 쓰므로
chatbot_service 는 mock 으로 주입한다.
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.modules.chat.models import AnswerFeedback, FeedbackType
from app.modules.chat.repository import ChatRepository
from app.modules.chat.schemas import FeedbackRequest
from app.modules.chat.service import ChatService

SESSION = "sess-abc"
OTHER_SESSION = "sess-xyz"


@pytest.fixture
async def repo():
    """AnswerFeedback 테이블만 생성한 in-memory DB 위 ChatRepository.

    SQLite FK 는 기본 비활성이므로 session_messages FK 없이 answer_feedback 단독
    테이블로 upsert 시맨틱을 격리 검증한다. StaticPool 로 단일 커넥션 공유 →
    in-memory DB 가 세션 간 유지된다.
    """
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all, tables=[AnswerFeedback.__table__]
        )
    session = AsyncSession(engine, expire_on_commit=False)
    try:
        yield ChatRepository(session)
    finally:
        await session.close()
        await engine.dispose()


def _service(repo: ChatRepository) -> ChatService:
    return ChatService(chat_repo=repo, chatbot_service=MagicMock())


def _req(message_id: uuid.UUID, feedback_type: str) -> FeedbackRequest:
    return FeedbackRequest(
        message_id=message_id,
        feedback_type=FeedbackType(feedback_type),
    )


async def _count(repo: ChatRepository, message_id: uuid.UUID) -> list[AnswerFeedback]:
    result = await repo.session.execute(
        select(AnswerFeedback).where(AnswerFeedback.message_id == message_id)
    )
    return list(result.scalars().all())


class TestUpsertSequence:
    @pytest.mark.asyncio
    async def test_like_cancel_like_dislike_ends_with_one_row(self, repo) -> None:
        """좋아요→취소→좋아요→싫어요 반복 후 row 정확히 1개, 마지막 값 유지."""
        svc = _service(repo)
        mid = uuid.uuid4()

        action, _ = await svc.upsert_feedback(_req(mid, "helpful"), SESSION)
        assert action == "created"
        assert len(await _count(repo, mid)) == 1

        removed = await svc.delete_feedback(mid, SESSION)
        assert removed is True
        assert len(await _count(repo, mid)) == 0

        action, _ = await svc.upsert_feedback(_req(mid, "helpful"), SESSION)
        assert action == "created"

        action, _ = await svc.upsert_feedback(_req(mid, "inaccurate"), SESSION)
        assert action == "updated"

        rows = await _count(repo, mid)
        assert len(rows) == 1
        assert rows[0].feedback_type == FeedbackType.INACCURATE

    @pytest.mark.asyncio
    async def test_resubmit_same_session_updates_not_inserts(self, repo) -> None:
        svc = _service(repo)
        mid = uuid.uuid4()
        await svc.upsert_feedback(_req(mid, "helpful"), SESSION)
        action, _ = await svc.upsert_feedback(_req(mid, "accurate"), SESSION)
        assert action == "updated"
        rows = await _count(repo, mid)
        assert len(rows) == 1
        assert rows[0].feedback_type == FeedbackType.ACCURATE

    @pytest.mark.asyncio
    async def test_different_sessions_get_own_rows(self, repo) -> None:
        """서로 다른 세션은 같은 메시지에 각자 1행씩."""
        svc = _service(repo)
        mid = uuid.uuid4()
        await svc.upsert_feedback(_req(mid, "helpful"), SESSION)
        await svc.upsert_feedback(_req(mid, "inaccurate"), OTHER_SESSION)
        assert len(await _count(repo, mid)) == 2


class TestDelete:
    @pytest.mark.asyncio
    async def test_delete_missing_is_idempotent(self, repo) -> None:
        svc = _service(repo)
        assert await svc.delete_feedback(uuid.uuid4(), SESSION) is False

    @pytest.mark.asyncio
    async def test_delete_only_targets_own_session(self, repo) -> None:
        svc = _service(repo)
        mid = uuid.uuid4()
        await svc.upsert_feedback(_req(mid, "helpful"), SESSION)
        await svc.upsert_feedback(_req(mid, "helpful"), OTHER_SESSION)
        assert await svc.delete_feedback(mid, SESSION) is True
        rows = await _count(repo, mid)
        assert len(rows) == 1
        assert rows[0].user_session_id == OTHER_SESSION


class TestUniqueConstraint:
    @pytest.mark.asyncio
    async def test_duplicate_insert_violates_unique(self, repo) -> None:
        """get 체크를 우회한 직접 중복 INSERT 는 unique 제약에 막힌다."""
        mid = uuid.uuid4()
        await repo.create_feedback(
            AnswerFeedback(
                message_id=mid,
                user_session_id=SESSION,
                feedback_type=FeedbackType.HELPFUL,
            )
        )
        with pytest.raises(IntegrityError):
            await repo.create_feedback(
                AnswerFeedback(
                    message_id=mid,
                    user_session_id=SESSION,
                    feedback_type=FeedbackType.INACCURATE,
                )
            )
