"""말씀 서고 3계층·읽기 기록 회귀 (PLAN-HD-007 트랙 A, API-HD-014/016 확장 · 023~028 · 053)."""

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
from app.modules.hoondok import journey_service, library_service
from app.modules.hoondok.display_text import to_display_text
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.library_repository import LibraryRepository
from app.modules.hoondok.library_series import label_sort_key, series_title, volume_label
from app.modules.hoondok.library_service import LibraryService, majority_grade
from app.modules.hoondok.models import (
    ContentRight,
    PassageHighlight,
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
# 구절 형광펜(API-HD-053) 기본 입력 — 7번 단락 5번째 글자부터 8번 단락 12번째 글자 앞까지
HIGHLIGHT = {
    "volume": "천성경.docx",
    "chunk_id": "c-7",
    "start_chunk_index": 7,
    "start_offset": 5,
    "end_chunk_index": 8,
    "end_offset": 12,
    "quote": "하루를 시작하고 서로를 존중하며",
    "color": 1,
}


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
                PassageHighlight.__table__,
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
    app.dependency_overrides[get_library_service] = lambda: LibraryService(library, qdrant)
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
    # 표시 라벨은 0 채움 없는 숫자다 — 파일명의 "001권" 을 그대로 보이지 않는다 (디자인 점검 서고 "001권" 재현)
    assert volume_label("말씀선집   001권.pdf", "father_anthology") == "1권"
    assert volume_label("말씀선집 56권", "father_anthology") == "56권"
    assert volume_label("말씀선집 355권.pdf", "father_anthology") == "355권"
    assert volume_label("천성경 (증보판).docx", "cheonseong_gyeong", "천성경") == "천성경"
    assert sorted(["10권", "100권", "1권"], key=label_sort_key) == ["1권", "10권", "100권"]
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
    assert [v["label"] for v in body["volumes"]] == ["1권", "10권", "100권"]
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
    # 목차로 고른 장이 그대로 현재 장이다 — 페이지 첫 청크(40)가 속한 앞 장을 보이지 않는다
    assert body["section"] == {"position": 2, "level": 2, "title": "제2장 하나님의 속성"}

    # section 없이 page 로만 들어오면 여전히 첫 청크를 품는 구간이다
    plain = ctx.get("/hoondok/words/천성경.docx?page=3").json()
    assert plain["section"] == {"position": 1, "level": 1, "title": "제1편 하나님"}

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
    assert items[0]["label"] == "1권"
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
        json={"volume": "천성경.docx", "chunk_index": 7, "kind": "bookmark", "color": 2},
        headers=XHR,
    )
    assert created.status_code == 200
    assert created.json()["color"] is None  # 북마크는 색을 버린다
    assert created.json()["note"] is None
    assert created.json()["work_title"] == "천성경"

    updated = ctx.put(
        "/hoondok/me/marks/c-1",
        json={"volume": "천성경.docx", "chunk_index": 7, "kind": "bookmark", "note": "기억할 단락"},
        headers=XHR,
    )
    assert updated.json()["note"] == "기억할 단락"
    assert len((await session.execute(select(PassageMark))).scalars().all()) == 1  # upsert

    ctx.put(
        "/hoondok/me/marks/c-2",
        json={"volume": "천성경.docx", "chunk_index": 8, "kind": "bookmark"},
        headers=XHR,
    )
    assert len(ctx.get("/hoondok/me/marks").json()["items"]) == 2
    assert len(ctx.get("/hoondok/me/marks?kind=bookmark").json()["items"]) == 2
    assert len(ctx.get("/hoondok/me/marks?volume=천성경.docx").json()["items"]) == 2

    assert ctx.delete("/hoondok/me/marks/c-1?kind=bookmark", headers=XHR).status_code == 204
    assert len(ctx.get("/hoondok/me/marks").json()["items"]) == 1
    # 없는 표시도 204
    assert ctx.delete("/hoondok/me/marks/nope?kind=bookmark", headers=XHR).status_code == 204


@pytest.mark.asyncio
async def test_mark_highlight_kind_is_rejected_and_volume_must_be_allowed(ctx: TestClient):
    """형광펜은 API-HD-053 구절 단위로 옮겼다 — 단락 표시의 `kind=highlight` 는 422."""
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    await login(ctx)
    assert (
        ctx.put(
            "/hoondok/me/marks/c-1",
            json={"volume": "천성경.docx", "chunk_index": 1, "kind": "highlight", "color": 2},
            headers=XHR,
        ).status_code
        == 422
    )
    assert ctx.get("/hoondok/me/marks?kind=highlight").status_code == 422
    assert ctx.delete("/hoondok/me/marks/c-1?kind=highlight", headers=XHR).status_code == 422
    assert (
        ctx.put(
            "/hoondok/me/marks/c-1",
            json={"volume": "없음.docx", "chunk_index": 1, "kind": "bookmark"},
            headers=XHR,
        ).status_code
        == 404
    )


@pytest.mark.asyncio
async def test_marks_list_ignores_legacy_highlight_rows(ctx: TestClient):
    """예전 `kind="highlight"` 행은 DB 에 남아도 목록에 나오지 않는다 — 나오면 MarkItem 검증이 500 을 낸다."""
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    user = await login(ctx)
    session.add_all(
        [
            PassageMark(
                user_id=user.id,
                chunk_id="c-1",
                volume="천성경.docx",
                chunk_index=1,
                kind="highlight",
                color=2,
                note="예전 노트",
            ),
            PassageMark(
                user_id=user.id, chunk_id="c-1", volume="천성경.docx", chunk_index=1, kind="bookmark"
            ),
        ]
    )
    await session.commit()

    response = ctx.get("/hoondok/me/marks")
    assert response.status_code == 200
    assert [(i["chunk_id"], i["kind"]) for i in response.json()["items"]] == [("c-1", "bookmark")]
    assert len(ctx.get("/hoondok/me/marks?volume=천성경.docx").json()["items"]) == 1
    # 예전 행은 지우지 않는다(데이터 삭제는 별도 절차)
    assert len((await session.execute(select(PassageMark))).scalars().all()) == 2


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
async def test_marks_list_is_capped_by_limit(ctx: TestClient):
    """표시가 쌓여도 한 요청이 읽는 행 수가 유한하다(리뷰 P1-3)."""
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    user = await login(ctx)
    session.add_all(
        [
            PassageMark(
                user_id=user.id,
                chunk_id=f"c-{index}",
                volume="천성경.docx",
                chunk_index=index,
                kind="bookmark",
            )
            for index in range(5)
        ]
    )
    await session.commit()

    assert len(ctx.get("/hoondok/me/marks").json()["items"]) == 5
    assert len(ctx.get("/hoondok/me/marks?limit=2").json()["items"]) == 2
    # 상한을 넘겨 요청하면 422 — 무제한 조회 경로를 열어 두지 않는다
    assert ctx.get("/hoondok/me/marks?limit=500").status_code == 422


# --- API-HD-026 `excerpt=true` 발췌 --------------------------------------------

_OVERLAP = "하나님의 뜻 앞에 서서 참된 마음으로 살아가는 길을 찾아야 합니다. "
_A_ID = {index: str(uuid.UUID(int=index + 1)) for index in (0, 4, 5, 19, 20)}
_B_ID = {index: str(uuid.UUID(int=100 + index)) for index in (2, 3)}
_ELSEWHERE_ID = str(uuid.UUID(int=999))  # payload 의 권이 표시의 권과 다른 청크


class _RecordingQdrant:
    """발췌용 가짜 Qdrant — 호출을 기록하고 point id → (volume, chunk_index, text) 로 답한다."""

    def __init__(self, fail: str | None = None) -> None:
        self.fail = fail
        self.calls: list[tuple[str, dict]] = []
        self.points: dict[str, tuple[str, int, str]] = {
            _A_ID[0]: ("천성경.docx", 0, "첫 단락입니다. " + BODY),
            _A_ID[4]: ("천성경.docx", 4, "앞 단락 본문입니다. " * 3 + _OVERLAP),
            _A_ID[5]: (
                "천성경.docx",
                5,
                _OVERLAP + "그러므로 우리는 오늘도 말씀을 가까이하며 사랑을 실천하는 하루를 보내야 합니다. " + BODY,
            ),
            _A_ID[19]: ("천성경.docx", 19, "앞 페이지 끝 단락입니다. " * 3 + _OVERLAP),
            _A_ID[20]: ("천성경.docx", 20, _OVERLAP + "새 페이지의 첫 단락은 앞 청크와 겹쳐도 자르지 않습니다. " + BODY),
            _B_ID[2]: ("평화경.docx", 2, "평화경 앞 단락입니다."),
            _B_ID[3]: ("평화경.docx", 3, "말씀" * 250),
            _ELSEWHERE_ID: ("평화경.docx", 9, BODY),
        }

    def _point(self, point_id: str) -> QdrantPoint:
        volume, index, text = self.points[point_id]
        return QdrantPoint(point_id, 0, {"volume": volume, "chunk_index": index, "text": text})

    async def retrieve(self, _collection, ids, **_kwargs):
        self.calls.append(("retrieve", {"ids": list(ids)}))
        if self.fail == "retrieve":
            raise RuntimeError("qdrant down")
        return [self._point(point_id) for point_id in ids if point_id in self.points]

    async def scroll(self, _collection, scroll_filter=None, limit=10, **_kwargs):
        self.calls.append(("scroll", {"filter": scroll_filter, "limit": limit}))
        if self.fail == "scroll":
            raise RuntimeError("qdrant down")
        volume_cond, index_cond = scroll_filter["must"]
        indices = set(index_cond["match"]["any"])
        found = [
            self._point(point_id)
            for point_id, (volume, index, _text) in self.points.items()
            if volume == volume_cond["match"]["value"] and index in indices
        ]
        return found[:limit], None

    def kinds(self) -> list[str]:
        return [kind for kind, _ in self.calls]


def use_qdrant(ctx: TestClient, qdrant: _RecordingQdrant) -> None:
    library = LibraryRepository(ctx.session)  # type: ignore[attr-defined]
    app.dependency_overrides[get_library_service] = lambda: LibraryService(library, qdrant)  # type: ignore[arg-type]


async def seed_excerpt_marks(ctx: TestClient) -> User:
    """열린 권 2개 + 검색만 열린 권·철회된 권·원장에 없는 권, 잘못된 ID·권이 어긋난 청크."""
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    await add_right(session, "평화경.docx")
    await add_right(session, "원리강론.docx", scope_full_text=False)
    await add_right(session, "통일사상.docx", status="withdrawn")
    user = await login(ctx)
    # 단락 표시는 북마크만 남았다(형광펜은 API-HD-053). 예전 highlight 행은 목록에 나오지 않으니 발췌도 묻지 않는다.
    marks = [
        (_A_ID[0], "천성경.docx", 0),
        (_A_ID[5], "천성경.docx", 5),
        (_A_ID[20], "천성경.docx", 20),
        (_B_ID[3], "평화경.docx", 3),
        ("c-1", "천성경.docx", 7),  # Qdrant ID 가 아니다
        (_ELSEWHERE_ID, "천성경.docx", 9),  # payload 는 평화경
        (str(uuid.UUID(int=500)), "원리강론.docx", 1),
        (str(uuid.UUID(int=501)), "통일사상.docx", 1),
        (str(uuid.UUID(int=502)), "없는 권.docx", 1),
    ]
    session.add_all(
        [
            PassageMark(user_id=user.id, chunk_id=chunk_id, volume=volume, chunk_index=index, kind="bookmark")
            for chunk_id, volume, index in marks
        ]
        + [
            PassageMark(
                user_id=user.id,
                chunk_id=_A_ID[4],
                volume="천성경.docx",
                chunk_index=4,
                kind="highlight",
                color=1,
            )
        ]
    )
    await session.commit()
    return user


def excerpt_of(items: list[dict], chunk_id: str) -> str | None:
    return next(i for i in items if i["chunk_id"] == chunk_id)["excerpt"]


def test_excerpt_page_size_matches_words_view():
    # 페이지 첫 청크 판정이 원문 뷰와 같아야 발췌가 화면 단락과 같다
    assert library_service.WORDS_PAGE_SIZE == journey_service.PAGE_SIZE


@pytest.mark.asyncio
async def test_marks_without_excerpt_param_keep_shape_and_skip_qdrant(ctx: TestClient):
    qdrant = _RecordingQdrant()
    use_qdrant(ctx, qdrant)
    await seed_excerpt_marks(ctx)

    for url in ("/hoondok/me/marks", "/hoondok/me/marks?excerpt=false"):
        items = ctx.get(url).json()["items"]
        assert len(items) == 9
        assert all("excerpt" not in item for item in items)
    put = ctx.put(
        f"/hoondok/me/marks/{_A_ID[5]}",
        json={"volume": "천성경.docx", "chunk_index": 5, "kind": "bookmark"},
        headers=XHR,
    )
    assert put.status_code == 200 and "excerpt" not in put.json()
    assert qdrant.calls == []


@pytest.mark.asyncio
async def test_marks_excerpt_uses_display_text_with_batched_calls(ctx: TestClient):
    qdrant = _RecordingQdrant()
    use_qdrant(ctx, qdrant)
    await seed_excerpt_marks(ctx)

    response = ctx.get("/hoondok/me/marks?excerpt=true")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 9 and all("excerpt" in item for item in items)

    # 호출 수: 청크 묶음 retrieve 1회 + 앞 청크가 필요한 권마다 scroll 1회
    assert qdrant.kinds() == ["retrieve", "scroll", "scroll"]
    ids = qdrant.calls[0][1]["ids"]
    assert len(ids) == len(set(ids))
    # 열린 권의 올바른 ID 만 묻는다 — 잘못된 ID·막힌 권은 보내지 않는다
    assert set(ids) == {_A_ID[0], _A_ID[5], _A_ID[20], _B_ID[3], _ELSEWHERE_ID}
    scrolled = {
        call["filter"]["must"][0]["match"]["value"]: call["filter"]["must"][1]["match"]["any"]
        for _, call in qdrant.calls[1:]
    }
    # 페이지 첫 청크(0·20)는 앞 청크를 찾지 않는다
    assert scrolled == {"천성경.docx": [4], "평화경.docx": [2]}

    points = qdrant.points
    # 겹침 제거 — 원문 뷰 display_text 와 같고 앞 청크와 겹친 머리가 없다
    assert excerpt_of(items, _A_ID[5]) == to_display_text(points[_A_ID[4]][2], points[_A_ID[5]][2])
    assert excerpt_of(items, _A_ID[5]).startswith("그러므로")
    # 페이지 첫 청크는 앞 청크 없이 — 겹친 머리를 그대로 둔다
    assert excerpt_of(items, _A_ID[20]) == to_display_text(None, points[_A_ID[20]][2])
    assert excerpt_of(items, _A_ID[20]).startswith("하나님의 뜻")
    assert excerpt_of(items, _A_ID[0]).startswith("첫 단락입니다.")
    # 300자에서 자른다
    assert excerpt_of(items, _B_ID[3]) == "말씀" * 150

    # 권리가 막힌 권·원장에 없는 권·잘못된 ID·권이 어긋난 청크는 null
    for chunk_id in (
        "c-1",
        _ELSEWHERE_ID,
        str(uuid.UUID(int=500)),
        str(uuid.UUID(int=501)),
        str(uuid.UUID(int=502)),
    ):
        assert excerpt_of(items, chunk_id) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("fail", ["retrieve", "scroll"])
async def test_marks_excerpt_falls_back_to_null_when_qdrant_fails(ctx: TestClient, fail: str):
    qdrant = _RecordingQdrant(fail=fail)
    use_qdrant(ctx, qdrant)
    await seed_excerpt_marks(ctx)

    response = ctx.get("/hoondok/me/marks?excerpt=true")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 9
    assert all(item["excerpt"] is None for item in items)


@pytest.mark.asyncio
async def test_marks_excerpt_skips_qdrant_when_nothing_is_readable(ctx: TestClient):
    qdrant = _RecordingQdrant()
    use_qdrant(ctx, qdrant)
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "원리강론.docx", scope_full_text=False)
    user = await login(ctx)

    assert ctx.get("/hoondok/me/marks?excerpt=true").json() == {"items": []}
    session.add(
        PassageMark(
            user_id=user.id,
            chunk_id=str(uuid.UUID(int=500)),
            volume="원리강론.docx",
            chunk_index=1,
            kind="bookmark",
        )
    )
    await session.commit()
    items = ctx.get("/hoondok/me/marks?excerpt=true").json()["items"]
    assert [item["excerpt"] for item in items] == [None]
    assert qdrant.calls == []


@pytest.mark.asyncio
async def test_me_routes_require_login_and_csrf(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    mark = {"volume": "천성경.docx", "chunk_index": 1, "kind": "bookmark"}
    assert ctx.get("/hoondok/me/reading-positions").status_code == 401
    assert ctx.get("/hoondok/me/marks").status_code == 401
    assert ctx.put("/hoondok/me/marks/c-1", json=mark, headers=XHR).status_code == 401

    highlight_url = f"/hoondok/me/highlights/{uuid.uuid4()}"
    assert ctx.get("/hoondok/me/highlights").status_code == 401
    assert ctx.post("/hoondok/me/highlights", json=HIGHLIGHT, headers=XHR).status_code == 401
    assert ctx.patch(highlight_url, json={"color": 2}, headers=XHR).status_code == 401
    assert ctx.delete(highlight_url, headers=XHR).status_code == 401

    await login(ctx)
    assert ctx.put("/hoondok/me/marks/c-1", json=mark).status_code == 403
    assert ctx.delete("/hoondok/me/marks/c-1").status_code == 403
    assert (
        ctx.put("/hoondok/me/reading-position/천성경.docx", json={"chunk_index": 1}).status_code == 403
    )
    assert ctx.post("/hoondok/me/highlights", json=HIGHLIGHT).status_code == 403
    assert ctx.patch(highlight_url, json={"color": 2}).status_code == 403
    assert ctx.delete(highlight_url).status_code == 403
    # CSRF 로 막힌 POST 는 아무것도 남기지 않는다
    assert (await session.execute(select(PassageHighlight))).scalars().all() == []


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
        ("POST", "/hoondok/me/highlights"),
        ("PATCH", "/hoondok/me/highlights/{highlight_id}"),
        ("DELETE", "/hoondok/me/highlights/{highlight_id}"),
    }
    found = set()
    for route, inherited in iter_api_routes(app):
        for method in getattr(route, "methods", None) or set():
            key = (method, getattr(route, "path", None))
            if key in mutating:
                assert verify_csrf in dependency_callables(route, inherited), f"{key} 에 verify_csrf 누락"
                found.add(key)
    assert found == mutating


# --- API-HD-053 구절 형광펜 --------------------------------------------------


@pytest.mark.asyncio
async def test_highlight_create_list_patch_and_delete(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx", book_series="cheonseong_gyeong", work_title="천성경")
    await login(ctx)

    created = ctx.post(
        "/hoondok/me/highlights", json={**HIGHLIGHT, "note": "  새길 말씀  "}, headers=XHR
    )
    assert created.status_code == 201
    body = created.json()
    highlight_id = body["id"]
    assert uuid.UUID(highlight_id)
    assert (body["start_chunk_index"], body["start_offset"]) == (7, 5)
    assert (body["end_chunk_index"], body["end_offset"]) == (8, 12)
    assert body["chunk_id"] == "c-7" and body["quote"] == HIGHLIGHT["quote"]
    assert body["color"] == 1 and body["note"] == "새길 말씀"  # 앞뒤 공백은 걷는다
    assert body["work_title"] == "천성경" and body["label"] == "천성경"

    # 같은 단락에 두 번째 형광펜 — unique 가 없어 별개 행이다
    second = ctx.post(
        "/hoondok/me/highlights",
        json={**HIGHLIGHT, "start_offset": 0, "end_chunk_index": 7, "end_offset": 3, "note": "   "},
        headers=XHR,
    )
    assert second.status_code == 201
    assert second.json()["note"] is None  # 공백뿐인 메모는 메모가 없는 것
    items = ctx.get("/hoondok/me/highlights").json()["items"]
    assert [i["id"] for i in items] == [second.json()["id"], highlight_id]  # 최신순
    assert len(ctx.get("/hoondok/me/highlights?volume=천성경.docx").json()["items"]) == 2
    assert ctx.get("/hoondok/me/highlights?volume=평화경.docx").json()["items"] == []
    assert len(ctx.get("/hoondok/me/highlights?limit=1").json()["items"]) == 1
    assert ctx.get("/hoondok/me/highlights?limit=501").status_code == 422

    url = f"/hoondok/me/highlights/{highlight_id}"
    recolored = ctx.patch(url, json={"color": 3}, headers=XHR)
    assert recolored.status_code == 200
    assert recolored.json()["color"] == 3 and recolored.json()["note"] == "새길 말씀"  # 보낸 필드만
    assert recolored.json()["updated_at"] >= body["updated_at"]
    # PATCH 는 최신순 맨 앞으로 올린다
    assert ctx.get("/hoondok/me/highlights").json()["items"][0]["id"] == highlight_id

    noted = ctx.patch(url, json={"note": "다시 읽기"}, headers=XHR)
    assert noted.json()["note"] == "다시 읽기" and noted.json()["color"] == 3
    assert ctx.patch(url, json={"note": None}, headers=XHR).json()["note"] is None
    ctx.patch(url, json={"note": "또 메모"}, headers=XHR)
    assert ctx.patch(url, json={"note": ""}, headers=XHR).json()["note"] is None
    # 색을 null 로 보내면 422 — 형광펜은 색 없이 둘 수 없다
    assert ctx.patch(url, json={"color": None}, headers=XHR).status_code == 422
    assert ctx.patch(url, json={"color": 4}, headers=XHR).status_code == 422
    # 범위·인용은 PATCH 로 바뀌지 않는다
    row = await session.get(PassageHighlight, uuid.UUID(highlight_id))
    assert row is not None and (row.start_offset, row.end_offset, row.color) == (5, 12, 3)

    assert ctx.delete(url, headers=XHR).status_code == 204
    assert ctx.delete(url, headers=XHR).status_code == 204  # 멱등
    assert ctx.patch(url, json={"color": 2}, headers=XHR).status_code == 404
    assert [i["id"] for i in ctx.get("/hoondok/me/highlights").json()["items"]] == [
        second.json()["id"]
    ]


@pytest.mark.asyncio
async def test_other_user_cannot_see_patch_or_delete_my_highlights(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    await login(ctx, "owner@example.com")
    highlight_id = ctx.post("/hoondok/me/highlights", json=HIGHLIGHT, headers=XHR).json()["id"]

    await login(ctx, "other@example.com")  # 쿠키 교체
    url = f"/hoondok/me/highlights/{highlight_id}"
    assert ctx.get("/hoondok/me/highlights").json()["items"] == []
    assert ctx.patch(url, json={"color": 3, "note": "남의 메모"}, headers=XHR).status_code == 404
    assert ctx.delete(url, headers=XHR).status_code == 204  # 멱등이지만 지우지 않는다
    row = await session.get(PassageHighlight, uuid.UUID(highlight_id))
    assert row is not None and row.color == 1 and row.note is None  # 주인의 형광펜은 그대로다


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "override",
    [
        {"end_chunk_index": 7, "end_offset": 5},  # 끝 = 시작
        {"end_chunk_index": 7, "end_offset": 2},  # 같은 단락에서 끝이 앞
        {"start_chunk_index": 8, "end_chunk_index": 7},  # 단락이 거꾸로
        {"start_chunk_index": 19, "end_chunk_index": 20},  # 페이지(20청크) 경계를 넘는다
        {"color": 0},
        {"color": 4},
        {"quote": ""},
        {"start_offset": -1},
        {"chunk_id": ""},
    ],
)
async def test_highlight_range_and_field_validation(ctx: TestClient, override: dict):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    await login(ctx)
    response = ctx.post("/hoondok/me/highlights", json={**HIGHLIGHT, **override}, headers=XHR)
    assert response.status_code == 422
    assert (await session.execute(select(PassageHighlight))).scalars().all() == []


@pytest.mark.asyncio
async def test_highlight_across_chunks_within_one_page_is_allowed(ctx: TestClient):
    """한 페이지(0~19, 20~39 …) 안이면 여러 단락에 걸쳐도 된다."""
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    await login(ctx)
    for start, end in [(0, 19), (20, 39)]:
        response = ctx.post(
            "/hoondok/me/highlights",
            json={**HIGHLIGHT, "start_chunk_index": start, "end_chunk_index": end},
            headers=XHR,
        )
        assert response.status_code == 201


@pytest.mark.asyncio
async def test_highlight_404_when_full_text_not_allowed(ctx: TestClient):
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "검색만.docx", scope_full_text=False)
    await add_right(session, "보류.docx", status="pending")
    await login(ctx)
    for volume in ("검색만.docx", "보류.docx", "없음.docx"):
        response = ctx.post("/hoondok/me/highlights", json={**HIGHLIGHT, "volume": volume}, headers=XHR)
        assert response.status_code == 404
    assert (await session.execute(select(PassageHighlight))).scalars().all() == []


@pytest.mark.asyncio
async def test_highlight_readable_follows_full_text_right(ctx: TestClient):
    """`readable` 은 원문(full_text)이 열린 권인지다 — 나의 기록이 quote·원문 링크를 가릴지 정한다.

    권리가 닫혀도 목록에서 빼지 않고(원문 뷰 동작 그대로) `readable` 만 false 로 알린다.
    """
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    right = await add_right(session, "천성경.docx")
    await add_right(session, "검색만.docx", scope_full_text=False)
    await add_right(session, "철회.docx", status="withdrawn")
    user = await login(ctx)
    created = ctx.post("/hoondok/me/highlights", json=HIGHLIGHT, headers=XHR)
    assert created.status_code == 201 and created.json()["readable"] is True

    # 권리가 닫히기 전에 남긴 형광펜 — 검색만 열린 권·철회된 권·원장에 없는 권
    session.add_all(
        [
            PassageHighlight(
                user_id=user.id,
                volume=volume,
                chunk_id="c-1",
                start_chunk_index=1,
                start_offset=0,
                end_chunk_index=1,
                end_offset=3,
                quote="말씀을",
                color=2,
            )
            for volume in ("검색만.docx", "철회.docx", "없음.docx")
        ]
    )
    await session.commit()
    items = ctx.get("/hoondok/me/highlights").json()["items"]
    assert {i["volume"]: i["readable"] for i in items} == {
        "천성경.docx": True,
        "검색만.docx": False,
        "철회.docx": False,
        "없음.docx": False,
    }
    # 기존 필드는 그대로다 — quote 를 가리는 일은 나의 기록 화면이 한다
    assert all(i["quote"] for i in items)

    # 권리를 거두면 PATCH 응답도 false
    right.scope_full_text = False
    await session.commit()
    patched = ctx.patch(
        f"/hoondok/me/highlights/{created.json()['id']}", json={"color": 3}, headers=XHR
    )
    assert patched.status_code == 200 and patched.json()["readable"] is False


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


def test_admin_rights_routes_require_admin_cookie():
    """관리자 쿠키 없이는 401 (test_hoondok_journey.test_admin_no_cookie_is_401 선례)."""
    client = TestClient(app)
    bulk = client.post(
        "/admin/hoondok/content-rights/bulk",
        json={
            "book_series": "father_anthology",
            "status": "allowed",
            "scope_search": True,
            "scope_full_text": True,
            "scope_jeongseong": False,
        },
        headers=XHR,
    )
    assert bulk.status_code == 401
    assert client.get("/admin/hoondok/content-rights/series").status_code == 401


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
    """API-HD-011 하드 삭제가 이어 읽기·표시·형광펜을 함께 지운다 — purger 등록 확인."""
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    await add_right(session, "천성경.docx")
    other = await login(ctx, "other@example.com")
    user = await login(ctx)  # 쿠키는 마지막 로그인(본인)
    ctx.put("/hoondok/me/reading-position/천성경.docx", json={"chunk_index": 3}, headers=XHR)
    ctx.put(
        "/hoondok/me/marks/c-1",
        json={"volume": "천성경.docx", "chunk_index": 3, "kind": "bookmark"},
        headers=XHR,
    )
    assert ctx.post("/hoondok/me/highlights", json=HIGHLIGHT, headers=XHR).status_code == 201
    session.add(PassageHighlight(user_id=other.id, **HIGHLIGHT))  # 다른 사람 것은 남아야 한다
    await session.commit()

    from app.modules.hoondok.dependencies import (
        get_card_repository,
        get_group_repository,
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
    app.dependency_overrides[get_group_repository] = lambda: _Noop()
    app.dependency_overrides[get_card_repository] = lambda: _Noop()
    try:
        assert ctx.delete("/hoondok/auth/me", headers=XHR).status_code == 204
    finally:
        for provider in (
            get_library_repository,
            get_mission_repository,
            get_jeongseong_repository,
            get_notification_repository,
            get_group_repository,
            get_card_repository,
        ):
            app.dependency_overrides.pop(provider, None)

    assert (await session.execute(select(ReadingPosition))).scalars().all() == []
    assert (await session.execute(select(PassageMark))).scalars().all() == []
    remaining = (await session.execute(select(PassageHighlight))).scalars().all()
    assert [row.user_id for row in remaining] == [other.id]
    refreshed = await session.get(User, user.id)
    assert refreshed is not None and refreshed.deleted_at is not None
