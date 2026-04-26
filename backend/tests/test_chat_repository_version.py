"""ChatRepository.get_messages_by_session 의 pipeline_version 필터 단위 테스트.

mock AsyncSession 기반 — select 호출 인자의 SQL 텍스트로 필터 적용 검증.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.chat.repository import ChatRepository


def _make_repo_with_capture():
    captured: dict = {}

    async def capture_execute(stmt):
        captured["stmt"] = stmt
        result = MagicMock()
        scalars = MagicMock()
        scalars.all.return_value = []
        result.scalars.return_value = scalars
        return result

    session = MagicMock()
    session.execute = AsyncMock(side_effect=capture_execute)
    repo = ChatRepository(session)
    return repo, captured


def _stmt_sql(stmt) -> str:
    return str(stmt.compile(compile_kwargs={"literal_binds": True}))


class TestGetMessagesByVersion:
    @pytest.mark.asyncio
    async def test_no_version_filter_when_none(self) -> None:
        repo, captured = _make_repo_with_capture()
        sid = uuid.uuid4()
        await repo.get_messages_by_session(sid)

        sql = _stmt_sql(captured["stmt"])
        # WHERE 절에 pipeline_version 비교가 없어야 함 (SELECT 절은 무관)
        assert "WHERE" in sql.upper()
        where_clause = sql.split("WHERE")[1] if "WHERE" in sql else sql.split("where")[1]
        assert "pipeline_version" not in where_clause

    @pytest.mark.asyncio
    async def test_filters_by_version_when_provided(self) -> None:
        repo, captured = _make_repo_with_capture()
        sid = uuid.uuid4()
        await repo.get_messages_by_session(sid, pipeline_version=2)

        sql = _stmt_sql(captured["stmt"])
        where_clause = sql.split("WHERE")[1] if "WHERE" in sql else sql.split("where")[1]
        assert "pipeline_version" in where_clause
        assert "= 2" in where_clause or "=2" in where_clause

    @pytest.mark.asyncio
    async def test_filters_by_version_1(self) -> None:
        repo, captured = _make_repo_with_capture()
        sid = uuid.uuid4()
        await repo.get_messages_by_session(sid, pipeline_version=1)

        sql = _stmt_sql(captured["stmt"])
        where_clause = sql.split("WHERE")[1] if "WHERE" in sql else sql.split("where")[1]
        assert "pipeline_version" in where_clause
        assert "= 1" in where_clause or "=1" in where_clause
