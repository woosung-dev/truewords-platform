"""말씀 서고 3계층·읽기 기록 회귀 (PLAN-HD-007 트랙 A, API-HD-014/016 확장 · 023~028)."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.core.config import settings
from app.main import app
from app.modules.admin.dependencies import get_admin_service, get_current_admin
from app.modules.admin.models import AdminAuditLog
from app.modules.admin.repository import AdminRepository
from app.modules.admin.service import AdminService
from app.modules.hoondok.dependencies import get_journey_service, get_library_service
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.library_repository import LibraryRepository
from app.modules.hoondok.library_series import label_sort_key, series_title, volume_label
from app.modules.hoondok.library_service import LibraryService, majority_grade
from app.modules.hoondok.models import (
    ContentRight,
    PassageMark,
    ReadingPosition,
    VolumeSection,
)
from app.modules.hoondok.repository import JeongseongRepository
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.service import IdentityService
from app.modules.qdrant import QdrantPoint

XHR = {"X-Requested-With": "XMLHttpRequest"}
ADMIN_ID = uuid.uuid4()
BODY = "감사하는 마음으로 하루를 시작하고 서로를 존중하며 작은 일에서도 사랑을 실천하는 삶을 살아가야 합니다."


@pytest.fixture
async def ctx():
    """aiosqlite 로 실 라우터·실 리포를 그대로 쓴다 (test_hoondok_journey.py 선례)."""
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[
                User.__table__,
                ContentRight.__table__,
                VolumeSection.__table__,
                ReadingPosition.__table__,
                PassageMark.__table__,
                AdminAuditLog.__table__,
            ],
        )
    session = AsyncSession(engine, expire_on_commit=False)
    library = LibraryRepository(session)
    qdrant = _FakeQdrant()
    journey = JourneyService(
        JourneyRepository(session),
        qdrant,
        JeongseongRepository(session),
        library=library,
    )
    users = UserRepository(session)
    app.dependency_overrides[get_library_service] = lambda: LibraryService(library)
    app.dependency_overrides[get_journey_service] = lambda: journey
    app.dependency_overrides[get_identity_repository] = lambda: users
    app.dependency_overrides[get_admin_service] = lambda: AdminService(AdminRepository(session))
    # require_admin_gate 가 데모 게이트 이메일을 확인한다 (main.py `_ADMIN_GATE`).
    app.dependency_overrides[get_current_admin] = lambda: {
        "user_id": ADMIN_ID,
        "email": settings.demo_admin_email,
    }
    client = TestClient(app)
    client.session = session  # type: ignore[attr-defined]
    client.qdrant = qdrant  # type: ignore[attr-defined]
    client.users = users  # type: ignore[attr-defined]
    try:
        yield client
    finally:
        for provider in (
            get_library_service,
            get_journey_service,
            get_identity_repository,
            get_admin_service,
            get_current_admin,
        ):
            app.dependency_overrides.pop(provider, None)
        await session.close()
        await engine.dispose()


class _FakeQdrant:
    """원문 조회에 필요한 최소 동작만. 청크 200개짜리 권 하나를 흉내낸다."""

    total = 200

    async def count(self, *_args, **_kwargs) -> int:
        return self.total

    async def scroll(self, _collection, scroll_filter=None, limit=20, **_kwargs):
        start = self.page_start
        points = [
            QdrantPoint(
                start + i,
                0,
                {"volume": "천성경.docx", "chunk_index": start + i, "text": f"{start + i} {BODY}"},
            )
            for i in range(limit)
        ]
        return points, None

    async def retrieve(self, _collection, ids):
        return []

    page_start = 0


async def add_right(session: AsyncSession, volume: str, **kwargs) -> ContentRight:
    defaults: dict = {
        "volume": volume,
        "work_title": kwargs.pop("work_title", volume),
        "status": "allowed",
        "scope_search": True,
        "scope_full_text": True,
    }
    defaults.update(kwargs)
    right = ContentRight(**defaults)
    session.add(right)
    await session.commit()
    return right


async def login(client: TestClient, email: str = "reader@example.com") -> User:
    from app.modules.identity.schemas import SignupRequest

    user = await IdentityService(client.users).signup(  # type: ignore[attr-defined]
        SignupRequest(email=email, password="password1", display_name="식구")
    )
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(user))
    return user


# --- 단위: 시리즈 상수 -------------------------------------------------------


def test_volume_label_and_sort_key():
    assert volume_label("말씀선집   001권.pdf", "father_anthology") == "001권"
    assert volume_label("말씀선집 56권", "father_anthology") == "056권"
    assert volume_label("천성경 (증보판).docx", "cheonseong_gyeong", "천성경") == "천성경"
    assert sorted(["010권", "100권", "001권"], key=label_sort_key) == ["001권", "010권", "100권"]
    assert series_title("cheonseong_gyeong") == "천성경"
    assert series_title("what_is_this") == "what_is_this"  # 미등록 키는 키 그대로


def test_majority_grade_ties_fall_back_to_r():
    assert majority_grade(["O1", "O1", "O2"]) == "O1"
    assert majority_grade(["O1", "O2"]) == "R"  # 동률
    assert majority_grade([]) == "R"


# --- API-HD-014 확장: works 집계 --------------------------------------------


@pytest.mark.asyncio
async def test_library_works_aggregates_by_series(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx", book_series="cheonseong_gyeong", authority_grade="O1")
    await add_right(session, "평화경.docx", book_series="pyeonghwa_gyeong", authority_grade="O1")
    await add_right(session, "말씀선집 001권.pdf", book_series="father_anthology", authority_grade="O1")
    await add_right(session, "말씀선집 002권.pdf", book_series="father_anthology", authority_grade="O2")
    await add_right(session, "말씀선집 003권.pdf", book_series="father_anthology", authority_grade="O1")
    # 등록만 되고 아직 열리지 않은 권 — volume_count 에는 들어가고 allowed_count 에는 빠진다
    await add_right(session, "말씀선집 004권.pdf", book_series="father_anthology", status="pending")
    # book_series 없는 행은 works 에서 제외(items 에는 남는다)
    await add_right(session, "기타 자료.docx")

    body = ctx.get("/hoondok/library").json()
    works = {w["series"]: w for w in body["works"]}
    assert set(works) == {"cheonseong_gyeong", "pyeonghwa_gyeong", "father_anthology"}
    assert len(body["items"]) == 6  # 허용 6권(pending 제외), 시리즈 없는 행 포함

    anthology = works["father_anthology"]
    assert anthology["title"] == "문선명선생 말씀선집"
    assert anthology["volume_count"] == 4  # pending 포함 등록 전체
    assert anthology["allowed_count"] == 3
    assert anthology["authority_grade"] == "O1"  # 최빈(O1 2건 > O2 1건)
    assert anthology["scope_search"] is True and anthology["scope_full_text"] is True
    assert [w["title"] for w in body["works"]] == sorted(w["title"] for w in body["works"])


@pytest.mark.asyncio
async def test_library_works_excludes_series_without_allowed_rows(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "통일사상요강.docx", book_series="tongil_thought", status="pending")
    body = ctx.get("/hoondok/library").json()
    assert body["works"] == [] and body["items"] == []


# --- API-HD-023 시리즈 상세 --------------------------------------------------


@pytest.mark.asyncio
async def test_series_detail_sorts_labels_and_counts_sections(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    for number, chunks in (("010", 300), ("001", 100), ("100", None)):
        await add_right(
            session,
            f"말씀선집   {number}권.pdf",
            book_series="father_anthology",
            authority_grade="O1",
            chunk_count=chunks,
        )
    session.add(
        VolumeSection(
            volume="말씀선집   001권.pdf",
            position=1,
            level=2,
            title="승리하는 하나님의 정병",
            start_chunk_index=0,
            end_chunk_index=19,
        )
    )
    await session.commit()

    body = ctx.get("/hoondok/library/father_anthology").json()
    assert body["title"] == "문선명선생 말씀선집" and body["authority_grade"] == "O1"
    assert [v["label"] for v in body["volumes"]] == ["001권", "010권", "100권"]
    assert [v["total_chunks"] for v in body["volumes"]] == [100, 300, None]
    assert [v["section_count"] for v in body["volumes"]] == [1, 0, 0]


@pytest.mark.asyncio
async def test_series_detail_404_when_unknown_or_no_allowed_rows(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    assert ctx.get("/hoondok/library/nope").status_code == 404
    await add_right(session, "천성경.docx", book_series="cheonseong_gyeong", status="withdrawn")
    assert ctx.get("/hoondok/library/cheonseong_gyeong").status_code == 404


# --- API-HD-024 장 목차 ------------------------------------------------------


@pytest.mark.asyncio
async def test_sections_rights_gate_and_empty_list(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    # 검색만 열린 권은 목차도 볼 수 없다 (API-HD-016 과 같은 게이트)
    await add_right(session, "검색만.docx", scope_full_text=False)
    assert ctx.get("/hoondok/sections/검색만.docx").status_code == 404
    assert ctx.get("/hoondok/sections/없는권.docx").status_code == 404

    await add_right(session, "천성경.docx", book_series="cheonseong_gyeong")
    assert ctx.get("/hoondok/sections/천성경.docx").json() == {
        "volume": "천성경.docx",
        "sections": [],
    }

    session.add(
        VolumeSection(
            volume="천성경.docx",
            position=1,
            level=1,
            title="제1편 하나님",
            start_chunk_index=0,
            end_chunk_index=99,
            spoken_on="1956-04-08",
            place="전 본부교회",
        )
    )
    await session.commit()
    sections = ctx.get("/hoondok/sections/천성경.docx").json()["sections"]
    assert sections == [
        {
            "position": 1,
            "level": 1,
            "title": "제1편 하나님",
            "start_chunk_index": 0,
            "end_chunk_index": 99,
            "spoken_on": "1956-04-08",
            "place": "전 본부교회",
        }
    ]


def test_sections_route_is_not_swallowed_by_words_path():
    """`/hoondok/words/{volume:path}` 는 greedy 라 목차를 별도 경로에 둔다 — 회귀 방지."""
    import sys

    sys.path.insert(0, "tests")
    from route_helpers import iter_api_routes

    paths = {getattr(r, "path", "") for r, _ in iter_api_routes(app)}
    assert "/hoondok/sections/{volume:path}" in paths
    assert "/hoondok/words/{volume:path}/sections" not in paths


# --- API-HD-016 확장: section 파라미터 --------------------------------------


@pytest.mark.asyncio
async def test_words_section_maps_to_page_and_returns_current_section(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx", book_series="cheonseong_gyeong")
    session.add_all(
        [
            VolumeSection(
                volume="천성경.docx",
                position=1,
                level=1,
                title="제1편 하나님",
                start_chunk_index=0,
                end_chunk_index=44,
            ),
            VolumeSection(
                volume="천성경.docx",
                position=2,
                level=2,
                title="제2장 하나님의 속성",
                start_chunk_index=45,
                end_chunk_index=99,
            ),
        ]
    )
    await session.commit()

    ctx.qdrant.page_start = 40  # type: ignore[attr-defined]
    body = ctx.get("/hoondok/words/천성경.docx?section=2").json()
    assert body["page"] == 3  # 45 // 20 + 1
    # 기존 필드는 그대로
    assert body["page_size"] == 20 and body["total_chunks"] == 200 and body["total_pages"] == 10
    assert body["work_title"] == "천성경.docx" and len(body["chunks"]) == 20
    # section 은 반환 페이지 첫 청크(40)를 품는 구간 = position 1
    assert body["section"] == {"position": 1, "level": 1, "title": "제1편 하나님"}

    assert ctx.get("/hoondok/words/천성경.docx?section=99").status_code == 404


@pytest.mark.asyncio
async def test_words_without_sections_returns_null_section(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    ctx.qdrant.page_start = 0  # type: ignore[attr-defined]
    assert ctx.get("/hoondok/words/천성경.docx").json()["section"] is None


# --- API-HD-025 이어 읽기 ----------------------------------------------------


@pytest.mark.asyncio
async def test_reading_position_upsert_and_newest_first(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx", book_series="cheonseong_gyeong", work_title="천성경")
    await add_right(
        session, "말씀선집   001권.pdf", book_series="father_anthology", work_title="말씀선집 1권"
    )
    await login(ctx)

    first = ctx.put("/hoondok/me/reading-position/천성경.docx", json={"chunk_index": 12}, headers=XHR)
    assert first.status_code == 200
    assert first.json()["chunk_index"] == 12 and first.json()["label"] == "천성경"
    assert first.json()["series"] == "cheonseong_gyeong"

    ctx.put("/hoondok/me/reading-position/천성경.docx", json={"chunk_index": 34}, headers=XHR)
    ctx.put(
        "/hoondok/me/reading-position/말씀선집   001권.pdf",
        json={"chunk_index": 5},
        headers=XHR,
    )
    rows = (await session.execute(select(ReadingPosition))).scalars().all()
    assert len(rows) == 2  # upsert — 천성경은 1행 유지

    items = ctx.get("/hoondok/me/reading-positions").json()["items"]
    assert [i["volume"] for i in items] == ["말씀선집   001권.pdf", "천성경.docx"]  # 최신순
    assert items[0]["label"] == "001권"
    assert items[1]["chunk_index"] == 34
    # volume 필터
    filtered = ctx.get("/hoondok/me/reading-positions?volume=천성경.docx").json()["items"]
    assert len(filtered) == 1 and filtered[0]["volume"] == "천성경.docx"


@pytest.mark.asyncio
async def test_reading_position_404_on_disallowed_volume(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "검색만.docx", scope_full_text=False)
    await login(ctx)
    assert (
        ctx.put("/hoondok/me/reading-position/검색만.docx", json={"chunk_index": 1}, headers=XHR).status_code
        == 404
    )
    assert (
        ctx.put("/hoondok/me/reading-position/없음.docx", json={"chunk_index": 1}, headers=XHR).status_code
        == 404
    )


# --- API-HD-026 단락 표시 ----------------------------------------------------


@pytest.mark.asyncio
async def test_marks_upsert_update_and_delete(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx", book_series="cheonseong_gyeong", work_title="천성경")
    await login(ctx)

    created = ctx.put(
        "/hoondok/me/marks/c-1",
        json={"volume": "천성경.docx", "chunk_index": 7, "kind": "highlight", "color": 2},
        headers=XHR,
    )
    assert created.status_code == 200
    assert created.json()["color"] == 2 and created.json()["note"] is None
    assert created.json()["work_title"] == "천성경"

    updated = ctx.put(
        "/hoondok/me/marks/c-1",
        json={
            "volume": "천성경.docx",
            "chunk_index": 7,
            "kind": "highlight",
            "color": 3,
            "note": "기억할 구절",
        },
        headers=XHR,
    )
    assert updated.json()["color"] == 3 and updated.json()["note"] == "기억할 구절"
    assert len((await session.execute(select(PassageMark))).scalars().all()) == 1

    # 같은 청크에 북마크는 별개 행 (unique 는 user·chunk·kind)
    bookmark = ctx.put(
        "/hoondok/me/marks/c-1",
        json={"volume": "천성경.docx", "chunk_index": 7, "kind": "bookmark", "color": 2},
        headers=XHR,
    )
    assert bookmark.json()["color"] is None  # 북마크는 색을 버린다
    assert len((await session.execute(select(PassageMark))).scalars().all()) == 2

    assert len(ctx.get("/hoondok/me/marks").json()["items"]) == 2
    assert len(ctx.get("/hoondok/me/marks?kind=bookmark").json()["items"]) == 1
    assert len(ctx.get("/hoondok/me/marks?volume=천성경.docx").json()["items"]) == 2

    assert ctx.delete("/hoondok/me/marks/c-1?kind=bookmark", headers=XHR).status_code == 204
    assert len(ctx.get("/hoondok/me/marks").json()["items"]) == 1
    # 없는 표시도 204
    assert ctx.delete("/hoondok/me/marks/nope?kind=bookmark", headers=XHR).status_code == 204


@pytest.mark.asyncio
async def test_highlight_requires_color_and_volume_must_be_allowed(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    await login(ctx)
    assert (
        ctx.put(
            "/hoondok/me/marks/c-1",
            json={"volume": "천성경.docx", "chunk_index": 1, "kind": "highlight"},
            headers=XHR,
        ).status_code
        == 422
    )
    assert (
        ctx.put(
            "/hoondok/me/marks/c-1",
            json={"volume": "없음.docx", "chunk_index": 1, "kind": "bookmark"},
            headers=XHR,
        ).status_code
        == 404
    )


@pytest.mark.asyncio
async def test_other_user_cannot_see_or_delete_my_marks(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    await login(ctx, "owner@example.com")
    ctx.put(
        "/hoondok/me/marks/c-1",
        json={"volume": "천성경.docx", "chunk_index": 1, "kind": "bookmark"},
        headers=XHR,
    )
    await login(ctx, "other@example.com")  # 쿠키 교체
    assert ctx.get("/hoondok/me/marks").json()["items"] == []
    assert ctx.delete("/hoondok/me/marks/c-1?kind=bookmark", headers=XHR).status_code == 204
    # 주인의 표시는 그대로다
    assert len((await session.execute(select(PassageMark))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_me_routes_require_login_and_csrf(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    mark = {"volume": "천성경.docx", "chunk_index": 1, "kind": "bookmark"}
    assert ctx.get("/hoondok/me/reading-positions").status_code == 401
    assert ctx.get("/hoondok/me/marks").status_code == 401
    assert ctx.put("/hoondok/me/marks/c-1", json=mark, headers=XHR).status_code == 401

    await login(ctx)
    assert ctx.put("/hoondok/me/marks/c-1", json=mark).status_code == 403
    assert ctx.delete("/hoondok/me/marks/c-1").status_code == 403
    assert (
        ctx.put("/hoondok/me/reading-position/천성경.docx", json={"chunk_index": 1}).status_code == 403
    )


def test_csrf_dependency_is_declared_on_every_mutating_route():
    """경로 의존성 누락을 라우트 정의 수준에서 잠근다 (test_hoondok_notifications.py 선례)."""
    import sys

    sys.path.insert(0, "tests")
    from app.modules.identity.dependencies import verify_csrf
    from route_helpers import dependency_callables, iter_api_routes

    mutating = {
        ("PUT", "/hoondok/me/reading-position/{volume:path}"),
        ("PUT", "/hoondok/me/marks/{chunk_id}"),
        ("DELETE", "/hoondok/me/marks/{chunk_id}"),
    }
    found = set()
    for route, inherited in iter_api_routes(app):
        for method in getattr(route, "methods", None) or set():
            key = (method, getattr(route, "path", None))
            if key in mutating:
                assert verify_csrf in dependency_callables(route, inherited), f"{key} 에 verify_csrf 누락"
                found.add(key)
    assert found == mutating


# --- API-HD-027·028 admin ----------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_updates_series_and_writes_one_audit_row(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    for number in ("001", "002"):
        await add_right(
            session,
            f"말씀선집   {number}권.pdf",
            book_series="father_anthology",
            status="pending",
            scope_search=False,
            scope_full_text=False,
            authority_grade="R",
        )
    await add_right(session, "천성경.docx", book_series="cheonseong_gyeong", status="pending")

    result = ctx.post(
        "/admin/hoondok/content-rights/bulk",
        json={
            "book_series": "father_anthology",
            "status": "allowed",
            "scope_search": True,
            "scope_full_text": True,
            "scope_jeongseong": False,
            "authority_grade": "O1",
        },
        headers=XHR,
    )
    assert result.status_code == 200
    assert result.json() == {"book_series": "father_anthology", "updated": 2}

    rows = (await session.execute(select(ContentRight))).scalars().all()
    anthology = [r for r in rows if r.book_series == "father_anthology"]
    assert all(r.status == "allowed" and r.authority_grade == "O1" for r in anthology)
    # 다른 시리즈는 그대로
    assert [r for r in rows if r.book_series == "cheonseong_gyeong"][0].status == "pending"

    logs = (await session.execute(select(AdminAuditLog))).scalars().all()
    assert len(logs) == 1
    assert logs[0].action == "content_right.bulk" and logs[0].target_table == "content_rights"
    assert logs[0].changes["book_series"] == "father_anthology"
    assert logs[0].changes["updated"] == 2


@pytest.mark.asyncio
async def test_bulk_without_grade_preserves_grade_and_404_on_unknown_series(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx", book_series="cheonseong_gyeong", authority_grade="O1")
    body = {
        "book_series": "cheonseong_gyeong",
        "status": "withdrawn",
        "scope_search": False,
        "scope_full_text": False,
        "scope_jeongseong": False,
    }
    assert ctx.post("/admin/hoondok/content-rights/bulk", json=body, headers=XHR).status_code == 200
    row = (await session.execute(select(ContentRight))).scalars().one()
    assert row.status == "withdrawn" and row.authority_grade == "O1"  # 등급 보존

    missing = ctx.post(
        "/admin/hoondok/content-rights/bulk",
        json={**body, "book_series": "nope"},
        headers=XHR,
    )
    assert missing.status_code == 404
    assert (await session.execute(select(AdminAuditLog))).scalars().all().__len__() == 1


@pytest.mark.asyncio
async def test_series_summary_counts_and_chunk_sum(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(
        session, "말씀선집   001권.pdf", book_series="father_anthology", chunk_count=100
    )
    await add_right(
        session,
        "말씀선집   002권.pdf",
        book_series="father_anthology",
        status="pending",
        chunk_count=200,
    )
    await add_right(
        session, "말씀선집   003권.pdf", book_series="father_anthology", status="withdrawn"
    )
    await add_right(session, "미지의책.docx", book_series="unknown_series")
    await add_right(session, "시리즈없음.docx")  # book_series None → 요약에서 제외

    items = {i["series"]: i for i in ctx.get("/admin/hoondok/content-rights/series").json()["items"]}
    assert set(items) == {"father_anthology", "unknown_series"}
    anthology = items["father_anthology"]
    assert anthology["title"] == "문선명선생 말씀선집"
    assert (anthology["registered"], anthology["allowed"]) == (3, 1)
    assert (anthology["pending"], anthology["withdrawn"]) == (1, 1)
    assert anthology["chunk_count"] == 300
    assert items["unknown_series"]["title"] == "unknown_series"  # 미등록 키는 키 그대로
    assert items["unknown_series"]["chunk_count"] is None  # 전부 NULL 이면 None


# --- 리포지토리 단위 ---------------------------------------------------------


@pytest.mark.asyncio
async def test_replace_auto_sections_keeps_manual_rows(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    repo = LibraryRepository(session)
    session.add_all(
        [
            VolumeSection(
                volume="천성경.docx",
                position=1,
                level=1,
                title="자동 1",
                start_chunk_index=0,
                end_chunk_index=9,
                origin="auto",
            ),
            VolumeSection(
                volume="천성경.docx",
                position=2,
                level=2,
                title="수기 2",
                start_chunk_index=10,
                end_chunk_index=19,
                origin="manual",
            ),
            VolumeSection(
                volume="평화경.docx",
                position=1,
                level=1,
                title="다른 권",
                start_chunk_index=0,
                end_chunk_index=9,
                origin="auto",
            ),
        ]
    )
    await session.commit()

    await repo.replace_auto_sections(
        "천성경.docx",
        [
            VolumeSection(
                volume="천성경.docx",
                position=3,
                level=2,
                title="자동 교체",
                start_chunk_index=20,
                end_chunk_index=29,
                origin="auto",
            )
        ],
    )
    rows = await repo.list_sections("천성경.docx")
    assert [(r.position, r.title, r.origin) for r in rows] == [
        (2, "수기 2", "manual"),
        (3, "자동 교체", "auto"),
    ]
    assert len(await repo.list_sections("평화경.docx")) == 1  # 다른 권은 건드리지 않는다


@pytest.mark.asyncio
async def test_account_deletion_purges_library_rows(ctx: TestClient):
    """API-HD-011 하드 삭제가 이어 읽기·표시를 함께 지운다 — purger 등록 확인."""
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    user = await login(ctx)
    ctx.put("/hoondok/me/reading-position/천성경.docx", json={"chunk_index": 3}, headers=XHR)
    ctx.put(
        "/hoondok/me/marks/c-1",
        json={"volume": "천성경.docx", "chunk_index": 3, "kind": "bookmark"},
        headers=XHR,
    )

    from app.modules.hoondok.dependencies import (
        get_jeongseong_repository,
        get_library_repository,
        get_mission_repository,
        get_notification_repository,
    )

    class _Noop:
        async def delete_for_user(self, _user_id) -> None:  # 이 테스트는 서고 테이블만 만든다
            return None

    app.dependency_overrides[get_library_repository] = lambda: LibraryRepository(session)
    app.dependency_overrides[get_mission_repository] = lambda: _Noop()
    app.dependency_overrides[get_jeongseong_repository] = lambda: _Noop()
    app.dependency_overrides[get_notification_repository] = lambda: _Noop()
    try:
        assert ctx.delete("/hoondok/auth/me", headers=XHR).status_code == 204
    finally:
        for provider in (
            get_library_repository,
            get_mission_repository,
            get_jeongseong_repository,
            get_notification_repository,
        ):
            app.dependency_overrides.pop(provider, None)

    assert (await session.execute(select(ReadingPosition))).scalars().all() == []
    assert (await session.execute(select(PassageMark))).scalars().all() == []
    refreshed = await session.get(User, user.id)
    assert refreshed is not None and refreshed.deleted_at is not None
