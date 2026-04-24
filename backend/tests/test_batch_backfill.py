"""batch_backfill 유틸 단위 테스트 (mock session, DB 없음).

설계: §19.15 X-1. 대상 코드: backend/src/alembic_support/batch_backfill.py
통합 실측(로컬 PG)은 docs/dev-log/29 참조.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from src.alembic_support.batch_backfill import run_batch_backfill


class _FakeSession:
    def __init__(self, parent: "FakeSessionFactory") -> None:
        self._parent = parent

    async def execute(self, stmt, params):
        self._parent.execute_calls.append((str(stmt), dict(params)))
        try:
            count = next(self._parent._iter)
        except StopIteration:
            count = 0
        result = MagicMock()
        result.rowcount = count
        return result

    async def commit(self):
        self._parent.commits += 1


class _SessionCtx:
    def __init__(self, parent: "FakeSessionFactory") -> None:
        self._parent = parent

    async def __aenter__(self):
        return _FakeSession(self._parent)

    async def __aexit__(self, exc_type, exc, tb):
        return None


class FakeSessionFactory:
    """asyncio context manager 로 동작하는 async_sessionmaker 대체물.

    `rowcounts` 리스트가 배치별 rowcount 를 순서대로 반환. 소진되면 0.
    """

    def __init__(self, rowcounts: list[int]) -> None:
        self._iter = iter(rowcounts)
        self.commits = 0
        self.execute_calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self):
        return _SessionCtx(self)


@pytest.mark.asyncio
async def test_stops_when_no_rows_updated():
    factory = FakeSessionFactory([500, 300, 0])
    total = await run_batch_backfill(
        factory,
        "UPDATE x SET y=1 LIMIT :n RETURNING id",
        batch_size=500,
        sleep_between_batches=0,
    )
    assert total == 800
    assert factory.commits == 3  # 배치별 독립 commit


@pytest.mark.asyncio
async def test_commits_per_batch_even_on_small_updates():
    factory = FakeSessionFactory([10, 10, 0])
    total = await run_batch_backfill(
        factory,
        "UPDATE x SET y=1 LIMIT :n RETURNING id",
        batch_size=1000,
        sleep_between_batches=0,
    )
    assert total == 20
    assert factory.commits == 3


@pytest.mark.asyncio
async def test_respects_max_batches():
    factory = FakeSessionFactory([100, 100, 100, 100, 100])  # 무한 반복 시뮬
    total = await run_batch_backfill(
        factory,
        "UPDATE x SET y=1 LIMIT :n RETURNING id",
        batch_size=100,
        sleep_between_batches=0,
        max_batches=3,
    )
    assert total == 300
    assert factory.commits == 3


@pytest.mark.asyncio
async def test_passes_extra_params():
    factory = FakeSessionFactory([0])
    await run_batch_backfill(
        factory,
        "UPDATE x SET y=:val WHERE z=:z LIMIT :n RETURNING id",
        params={"val": "hello", "z": 42},
        sleep_between_batches=0,
    )
    assert len(factory.execute_calls) == 1
    _, params = factory.execute_calls[0]
    assert params["val"] == "hello"
    assert params["z"] == 42
    assert params["n"] == 1000  # default batch_size


@pytest.mark.asyncio
async def test_empty_first_batch_terminates():
    factory = FakeSessionFactory([0])
    total = await run_batch_backfill(
        factory,
        "UPDATE x SET y=1 LIMIT :n RETURNING id",
        sleep_between_batches=0,
    )
    assert total == 0
    assert factory.commits == 1


@pytest.mark.asyncio
async def test_negative_rowcount_treated_as_zero():
    """rowcount 미지원 driver 방어 — -1 반환 시 종료로 취급."""
    factory = FakeSessionFactory([])  # 빈 iter → StopIteration → count=0 로 처리
    rowcounts = [100, -1]

    # MonkeyPatch: rowcount 가 -1 인 상황 만들기
    class _NegFactory(FakeSessionFactory):
        def __init__(self):
            super().__init__([])
            self._custom_iter = iter(rowcounts)

        def __call__(self):
            parent = self

            class _Ctx:
                async def __aenter__(self):
                    return _CustomSession(parent)

                async def __aexit__(self, *a):
                    return None

            return _Ctx()

    class _CustomSession:
        def __init__(self, parent):
            self._parent = parent

        async def execute(self, stmt, params):
            self._parent.execute_calls.append((str(stmt), dict(params)))
            count = next(self._parent._custom_iter)
            result = MagicMock()
            result.rowcount = count
            return result

        async def commit(self):
            self._parent.commits += 1

    f = _NegFactory()
    total = await run_batch_backfill(
        f,
        "UPDATE x SET y=1 LIMIT :n RETURNING id",
        sleep_between_batches=0,
    )
    # 100 유효 + -1 → 0 으로 변환되어 종료. total = 100 + 0.
    assert total == 100
    assert f.commits == 2
