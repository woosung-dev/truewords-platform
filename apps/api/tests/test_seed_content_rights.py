"""권리 원장 시드 회귀 (PLAN-HD-007 트랙 D · seed_content_rights_from_qdrant)."""

import sys
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from app.modules.hoondok.models import ContentRight  # noqa: E402
from app.modules.qdrant.raw_client import FacetHit, QdrantPoint  # noqa: E402
from seed_content_rights_from_qdrant import (  # noqa: E402
    classify_volume_series,
    list_volume_counts,
    resolve_allow,
    seed,
)

# 운영 사본에 실제로 있는 파일명 표본
SAMPLE = {
    "말씀선집   001권.pdf": 675,
    "말씀선집 308권 .pdf": 649,
    "천성경.pdf": 4283,
    "평화경.txt": 3304,
    "원리강론.txt": 830,
    "통일사상요강.txt": 1291,
    "평화를 사랑하는 세계인으로.txt": 415,
    "0.천원궁 관련 참어머님 말씀 (1).docx": 18,
    "한민족 선민 대서사시.txt": 104,
}


class FakeQdrant:
    """facet 을 쓸 수 있는/없는 Qdrant 를 모두 흉내낸다."""

    def __init__(self, counts: dict[str, int], *, facet_ok: bool) -> None:
        self.counts = counts
        self.facet_ok = facet_ok
        self.scrolled = 0

    async def facet(self, collection, *, key, limit=100, exact=False):
        if not self.facet_ok:
            raise RuntimeError("Not found: /facet")
        return [FacetHit(value=volume, count=count) for volume, count in self.counts.items()]

    async def scroll(self, collection, *, with_payload=True, limit=1000, offset=None, **kwargs):
        self.scrolled += 1
        points = [
            QdrantPoint(id=f"{volume}:{index}", score=0.0, payload={"volume": volume})
            for volume, count in self.counts.items()
            for index in range(count)
        ]
        return points, None


@pytest.fixture
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all, tables=[ContentRight.__table__])
    async with AsyncSession(engine, expire_on_commit=False) as opened:
        yield opened
    await engine.dispose()


@pytest.fixture(autouse=True)
def _use_test_session(monkeypatch, session):
    """스크립트의 `async_session_factory` 를 테스트 세션으로 바꾼다(커밋은 그대로 확인)."""
    import seed_content_rights_from_qdrant as script

    class Factory:
        def __call__(self):
            return self

        async def __aenter__(self):
            return session

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(script, "async_session_factory", Factory())


async def _rights(session) -> dict[str, ContentRight]:
    result = await session.execute(select(ContentRight))
    return {row.volume: row for row in result.scalars().all()}


# --- 분류 ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("volume", "series"),
    [
        ("말씀선집   001권.pdf", "father_anthology"),
        ("말씀선집 308권 .pdf", "father_anthology"),
        ("천성경.pdf", "cheonseong_gyeong"),
        ("평화경.txt", "pyeonghwa_gyeong"),
        ("원리강론.txt", "wonri_gangron"),
        ("통일사상요강.txt", "tongil_thought"),
        ("평화를 사랑하는 세계인으로.txt", "chambumo_autobiography"),
        ("0.천원궁 관련 참어머님 말씀 (1).docx", ""),
        ("한민족 선민 대서사시.txt", ""),
    ],
)
def test_classify_volume_series(volume: str, series: str):
    assert classify_volume_series(volume) == series


def test_resolve_allow_accepts_titles_and_keys():
    assert resolve_allow("천성경,평화경,wonri_gangron") == {
        "cheonseong_gyeong",
        "pyeonghwa_gyeong",
        "wonri_gangron",
    }
    assert resolve_allow("") == set()
    with pytest.raises(ValueError):
        resolve_allow("참어머님 말씀")


# --- Qdrant 열거 -----------------------------------------------------------


async def test_list_volume_counts_prefers_facet():
    client = FakeQdrant(SAMPLE, facet_ok=True)
    assert await list_volume_counts(client, "c") == SAMPLE
    assert client.scrolled == 0


async def test_list_volume_counts_falls_back_to_scroll(capsys):
    client = FakeQdrant({"천성경.pdf": 3, "원리강론.txt": 2}, facet_ok=False)
    assert await list_volume_counts(client, "c") == {"천성경.pdf": 3, "원리강론.txt": 2}
    assert client.scrolled == 1
    assert "facet 사용 불가" in capsys.readouterr().out


# --- 시드 ------------------------------------------------------------------


async def test_dry_run_writes_nothing_and_lists_skipped(session, capsys):
    await seed(SAMPLE, allow=set(), grade="O1", execute=False)
    assert await _rights(session) == {}
    out = capsys.readouterr().out
    assert "[dry-run]" in out
    assert "한민족 선민 대서사시.txt" in out
    assert "0.천원궁 관련 참어머님 말씀 (1).docx" in out


async def test_execute_creates_pending_rows_with_chunk_count(session):
    await seed(SAMPLE, allow=set(), grade="O1", execute=True)
    rights = await _rights(session)
    assert set(rights) == {v for v in SAMPLE if classify_volume_series(v)}
    right = rights["천성경.pdf"]
    assert (right.status, right.scope_search, right.scope_full_text) == ("pending", False, False)
    assert (right.authority_grade, right.book_series, right.chunk_count) == (
        "R",
        "cheonseong_gyeong",
        4283,
    )
    assert rights["말씀선집   001권.pdf"].work_title == "문선명선생 말씀선집"


async def test_allow_opens_listed_series_only(session):
    await seed(SAMPLE, allow={"cheonseong_gyeong", "pyeonghwa_gyeong"}, grade="O1", execute=True)
    rights = await _rights(session)
    opened = rights["천성경.pdf"]
    assert (opened.status, opened.scope_search, opened.scope_full_text) == ("allowed", True, True)
    assert opened.authority_grade == "O1"
    assert opened.scope_jeongseong is False
    assert rights["원리강론.txt"].status == "pending"


async def test_existing_rows_keep_operator_decisions(session):
    session.add(
        ContentRight(
            volume="천성경.pdf",
            status="withdrawn",
            scope_search=True,
            scope_full_text=True,
            scope_jeongseong=True,
            work_title="천성경 (운영자 수정)",
            source_keys=["M"],
            authority_grade="O2",
            note="운영자 메모",
        )
    )
    await session.commit()

    await seed(SAMPLE, allow=set(), grade="O1", execute=True)
    right = (await _rights(session))["천성경.pdf"]
    assert right.status == "withdrawn"
    assert right.authority_grade == "O2"
    assert right.note == "운영자 메모"
    assert right.work_title == "천성경 (운영자 수정)"
    # 분류·청크 수만 보정한다
    assert (right.book_series, right.chunk_count) == ("cheonseong_gyeong", 4283)


async def test_allow_reopens_existing_rows(session):
    session.add(
        ContentRight(volume="천성경.pdf", work_title="", source_keys=[], status="pending")
    )
    await session.commit()

    await seed(SAMPLE, allow={"cheonseong_gyeong"}, grade="O1", execute=True)
    right = (await _rights(session))["천성경.pdf"]
    assert (right.status, right.authority_grade) == ("allowed", "O1")
    assert right.scope_search and right.scope_full_text
    assert right.work_title == "천성경"  # 비어 있던 표시 제목만 채운다


async def test_allow_does_not_reopen_withdrawn_rows(session, capsys):
    """운영자가 철회한 권은 --allow 재실행으로 되살아나지 않는다(리뷰 P2-1)."""
    session.add(
        ContentRight(
            volume="천성경.pdf",
            status="withdrawn",
            scope_search=False,
            scope_full_text=False,
            work_title="천성경",
            source_keys=[],
            authority_grade="O2",
        )
    )
    await session.commit()

    await seed(SAMPLE, allow={"cheonseong_gyeong"}, grade="O1", execute=True)
    right = (await _rights(session))["천성경.pdf"]
    assert (right.status, right.authority_grade) == ("withdrawn", "O2")
    assert not right.scope_search and not right.scope_full_text
    # 건너뛴 사실은 stdout 으로 알린다
    assert "천성경.pdf" in capsys.readouterr().out


async def test_invalid_grade_is_rejected():
    """등급 오타가 원장에 들어가면 공개 서고 직렬화가 깨진다(리뷰 P1-4)."""
    from seed_content_rights_from_qdrant import _main

    original = sys.argv
    sys.argv = ["seed_content_rights_from_qdrant.py", "--dry-run", "--grade", "o1"]
    try:
        with pytest.raises(SystemExit) as error:
            await _main()
    finally:
        sys.argv = original
    assert error.value.code == 2
