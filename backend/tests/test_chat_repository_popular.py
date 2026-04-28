"""ChatRepository.get_popular_questions 단위 테스트.

mock AsyncSession 기반으로 ``select`` 호출 인자의 SQL 텍스트 + 적용 절을
검증한다. period=None 분기, period_days 분기, limit, chatbot 필터링.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.chat.repository import ChatRepository


def _make_repo_with_capture(rows: list[tuple[str, int]] | None = None):
    captured: dict = {}
    rows = rows or []

    async def capture_execute(stmt):
        captured["stmt"] = stmt
        result = MagicMock()
        result.all.return_value = rows
        return result

    session = MagicMock()
    session.execute = AsyncMock(side_effect=capture_execute)
    repo = ChatRepository(session)
    return repo, captured


def _stmt_sql(stmt) -> str:
    return str(stmt.compile(compile_kwargs={"literal_binds": True}))


class TestGetPopularQuestions:
    @pytest.mark.asyncio
    async def test_returns_question_count_pairs(self) -> None:
        repo, _ = _make_repo_with_capture(
            rows=[("질문 A", 10), ("질문 B", 5), ("질문 C", 1)],
        )
        cid = uuid.uuid4()
        result = await repo.get_popular_questions(cid, period_days=7, limit=10)

        assert result == [("질문 A", 10), ("질문 B", 5), ("질문 C", 1)]

    @pytest.mark.asyncio
    async def test_filters_by_chatbot_id(self) -> None:
        """SQL WHERE 에 chatbot_config_id 비교가 포함된다."""
        repo, captured = _make_repo_with_capture()
        cid = uuid.uuid4()
        await repo.get_popular_questions(cid, period_days=7, limit=10)

        sql = _stmt_sql(captured["stmt"])
        assert "chatbot_config_id" in sql
        # SQLite 리터럴 직렬화는 dash 를 제거한 hex 형태로 bind 한다.
        assert cid.hex in sql

    @pytest.mark.asyncio
    async def test_filters_user_role_only(self) -> None:
        repo, captured = _make_repo_with_capture()
        cid = uuid.uuid4()
        await repo.get_popular_questions(cid, period_days=7, limit=10)

        sql = _stmt_sql(captured["stmt"])
        # MessageRole.USER 의 enum 직렬화 — dialect 에 따라 'USER' 또는 'user'.
        # 두 케이스 모두 허용.
        assert "'user'" in sql.lower() or "'USER'" in sql

    @pytest.mark.asyncio
    async def test_period_days_adds_created_at_filter(self) -> None:
        repo, captured = _make_repo_with_capture()
        cid = uuid.uuid4()
        await repo.get_popular_questions(cid, period_days=7, limit=10)

        sql = _stmt_sql(captured["stmt"])
        assert "created_at" in sql

    @pytest.mark.asyncio
    async def test_period_none_skips_created_at_filter(self) -> None:
        """period_days=None (= all) → WHERE 에 created_at 비교가 없어야 한다."""
        repo, captured = _make_repo_with_capture()
        cid = uuid.uuid4()
        await repo.get_popular_questions(cid, period_days=None, limit=10)

        sql = _stmt_sql(captured["stmt"])
        # WHERE 절만 발췌 후 created_at 부재 검증.
        upper = sql.upper()
        if "WHERE" in upper:
            where_clause = sql[upper.index("WHERE") :].split("GROUP BY")[0]
            assert "created_at" not in where_clause.lower()

    @pytest.mark.asyncio
    async def test_limit_applied(self) -> None:
        repo, captured = _make_repo_with_capture()
        cid = uuid.uuid4()
        await repo.get_popular_questions(cid, period_days=7, limit=3)

        sql = _stmt_sql(captured["stmt"])
        assert "LIMIT 3" in sql.upper()

    @pytest.mark.asyncio
    async def test_group_by_content(self) -> None:
        repo, captured = _make_repo_with_capture()
        cid = uuid.uuid4()
        await repo.get_popular_questions(cid, period_days=7, limit=10)

        sql = _stmt_sql(captured["stmt"]).upper()
        assert "GROUP BY" in sql
        assert "CONTENT" in sql

    @pytest.mark.asyncio
    async def test_order_by_count_desc(self) -> None:
        repo, captured = _make_repo_with_capture()
        cid = uuid.uuid4()
        await repo.get_popular_questions(cid, period_days=7, limit=10)

        sql = _stmt_sql(captured["stmt"]).upper()
        # ORDER BY cnt DESC — 라벨 또는 count(...) 컬럼.
        assert "ORDER BY" in sql
        assert "DESC" in sql

    @pytest.mark.asyncio
    async def test_empty_result(self) -> None:
        repo, _ = _make_repo_with_capture(rows=[])
        cid = uuid.uuid4()
        result = await repo.get_popular_questions(cid, period_days=7, limit=10)

        assert result == []
