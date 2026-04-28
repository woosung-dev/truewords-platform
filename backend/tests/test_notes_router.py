"""P1-H — 인용 카드 노트 모델 + repository + schema + endpoint 단위 테스트.

reactions worktree (B2) 와 동일한 정책: HTTP-level e2e 통합은 chatbot_configs FK
의존 등으로 무거우므로 본 worktree 에서는
 - 모델/스키마 검증
 - Repository upsert 시맨틱 (insert / update / idempotent / race fallback)
 - endpoint 의 경량 단위 흐름 (FastAPI TestClient + sqlite in-memory)
에 집중한다.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from pydantic import ValidationError

from src.chat.models import ChatMessageNote
from src.chat.notes_schemas import (
    NOTE_BODY_MAX_LENGTH,
    CitationNoteResponse,
    CitationNoteUpsertRequest,
)


class TestNoteSchema:
    """Pydantic 검증."""

    def test_valid_request(self) -> None:
        req = CitationNoteUpsertRequest(chunk_id="chunk-1", body="hello")
        assert req.chunk_id == "chunk-1"
        assert req.body == "hello"

    def test_empty_chunk_id_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CitationNoteUpsertRequest(chunk_id="", body="hello")

    def test_chunk_id_length_limit(self) -> None:
        with pytest.raises(ValidationError):
            CitationNoteUpsertRequest(chunk_id="x" * 129, body="hello")

    def test_body_length_limit(self) -> None:
        with pytest.raises(ValidationError):
            CitationNoteUpsertRequest(
                chunk_id="chunk-1",
                body="a" * (NOTE_BODY_MAX_LENGTH + 1),
            )

    def test_body_can_be_empty(self) -> None:
        # 빈 문자열은 유효 (사용자가 노트를 지운 경우).
        req = CitationNoteUpsertRequest(chunk_id="chunk-1", body="")
        assert req.body == ""

    def test_user_session_id_not_in_request(self) -> None:
        """B2 보안 — user_session_id 는 cookie 발급, body 에 포함되지 않는다."""
        assert "user_session_id" not in CitationNoteUpsertRequest.model_fields


class TestChatMessageNoteModel:
    def test_instantiate(self) -> None:
        note = ChatMessageNote(
            message_id=uuid.uuid4(),
            chunk_id="chunk-1",
            user_session_id="anon-1",
            body="memo",
        )
        assert note.chunk_id == "chunk-1"
        assert note.body == "memo"
        assert note.user_session_id == "anon-1"


class TestNoteResponse:
    def test_serialize(self) -> None:
        resp = CitationNoteResponse(
            id=uuid.uuid4(),
            message_id=uuid.uuid4(),
            chunk_id="chunk-1",
            body="memo",
            updated_at=datetime.utcnow(),
        )
        dumped = resp.model_dump()
        assert dumped["chunk_id"] == "chunk-1"
        assert dumped["body"] == "memo"


# ---------------------------------------------------------------------------
# Repository — 실제 sqlite in-memory 로 upsert 시맨틱 검증.
# ---------------------------------------------------------------------------


@pytest.fixture
async def in_memory_session():
    """sqlite in-memory async session — ChatMessageNote 단독 생성.

    FK cascade(session_messages → research_sessions) 를 회피하기 위해
    ChatMessageNote 테이블의 ForeignKey 제약을 임시로 제거한 뒤 create_all 한다.
    실 운영 FK / unique 동작은 alembic 마이그레이션으로 보장한다.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy import MetaData
    from sqlmodel.ext.asyncio.session import AsyncSession

    target_table = ChatMessageNote.__table__
    # FK 제약을 보관 후 drop — 같은 Table 객체를 사용하므로 yield 후 복원.
    saved_fks = list(target_table.foreign_key_constraints)
    for fk in saved_fks:
        target_table.constraints.discard(fk)
    # 컬럼-레벨 ForeignKey 도 제거 (column.foreign_keys 가 비어 있어야 metadata
    # 가 해당 테이블을 단독 생성할 수 있다).
    saved_col_fks: list[tuple] = []
    for col in target_table.columns:
        for fk in list(col.foreign_keys):
            saved_col_fks.append((col, fk))
            col.foreign_keys.discard(fk)

    isolated_metadata = MetaData()
    target_table.to_metadata(isolated_metadata)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with engine.begin() as conn:
            await conn.run_sync(isolated_metadata.create_all)

        async with factory() as session:
            yield session
    finally:
        # 복원 — 다른 테스트가 원본 metadata 를 그대로 쓰도록.
        for col, fk in saved_col_fks:
            col.foreign_keys.add(fk)
        for fk in saved_fks:
            target_table.append_constraint(fk)
        await engine.dispose()


class TestRepositoryUpsert:
    @pytest.mark.asyncio
    async def test_insert_when_absent(self, in_memory_session) -> None:
        from src.chat.notes_repository import ChatMessageNoteRepository

        repo = ChatMessageNoteRepository(in_memory_session)
        msg_id = uuid.uuid4()
        note = await repo.upsert(
            message_id=msg_id,
            chunk_id="chunk-1",
            user_session_id="anon-1",
            body="first memo",
        )
        await in_memory_session.commit()

        assert note.body == "first memo"
        fetched = await repo.get(
            message_id=msg_id, chunk_id="chunk-1", user_session_id="anon-1"
        )
        assert fetched is not None
        assert fetched.body == "first memo"

    @pytest.mark.asyncio
    async def test_update_when_present(self, in_memory_session) -> None:
        from src.chat.notes_repository import ChatMessageNoteRepository

        repo = ChatMessageNoteRepository(in_memory_session)
        msg_id = uuid.uuid4()
        first = await repo.upsert(
            message_id=msg_id,
            chunk_id="chunk-1",
            user_session_id="anon-1",
            body="v1",
        )
        await in_memory_session.commit()

        second = await repo.upsert(
            message_id=msg_id,
            chunk_id="chunk-1",
            user_session_id="anon-1",
            body="v2",
        )
        await in_memory_session.commit()

        assert first.id == second.id  # 같은 row 업데이트
        assert second.body == "v2"

        # 단일 row 만 유지되는지.
        from sqlmodel import select

        all_rows = (
            await in_memory_session.exec(
                select(ChatMessageNote).where(
                    ChatMessageNote.message_id == msg_id,
                    ChatMessageNote.chunk_id == "chunk-1",
                    ChatMessageNote.user_session_id == "anon-1",
                )
            )
        ).all()
        assert len(all_rows) == 1

    @pytest.mark.asyncio
    async def test_isolation_per_user(self, in_memory_session) -> None:
        """동일 (message_id, chunk_id) 라도 user_session_id 가 다르면 별도 row."""
        from src.chat.notes_repository import ChatMessageNoteRepository

        repo = ChatMessageNoteRepository(in_memory_session)
        msg_id = uuid.uuid4()
        await repo.upsert(
            message_id=msg_id,
            chunk_id="chunk-1",
            user_session_id="anon-A",
            body="A's memo",
        )
        await repo.upsert(
            message_id=msg_id,
            chunk_id="chunk-1",
            user_session_id="anon-B",
            body="B's memo",
        )
        await in_memory_session.commit()

        a = await repo.get(
            message_id=msg_id, chunk_id="chunk-1", user_session_id="anon-A"
        )
        b = await repo.get(
            message_id=msg_id, chunk_id="chunk-1", user_session_id="anon-B"
        )
        assert a is not None and a.body == "A's memo"
        assert b is not None and b.body == "B's memo"
        assert a.id != b.id

    @pytest.mark.asyncio
    async def test_get_returns_none_when_absent(self, in_memory_session) -> None:
        from src.chat.notes_repository import ChatMessageNoteRepository

        repo = ChatMessageNoteRepository(in_memory_session)
        result = await repo.get(
            message_id=uuid.uuid4(),
            chunk_id="never-existed",
            user_session_id="anon-1",
        )
        assert result is None
