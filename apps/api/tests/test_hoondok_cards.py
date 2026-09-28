"""오늘의 책갈피 (PLAN-HD-012, API-HD-047~052) — 회전 규칙·공개 범위·멱등 받기/건넴·책장·admin."""

import uuid
from datetime import date, datetime, timedelta

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
from app.modules.hoondok.cards_repository import CardRepository
from app.modules.hoondok.cards_service import CardAdminService, CardService, pick_today_card
from app.modules.hoondok.dependencies import get_card_admin_service, get_card_service
from app.modules.hoondok.models import CardReceipt, WordCard
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.service import IdentityService

XHR = {"X-Requested-With": "XMLHttpRequest"}
TODAY = date(2026, 9, 28)
BASE = datetime(2026, 9, 1)


def make_card(n: int, *, status: str = "active", pinned_on: date | None = None, work_title: str = "천성경") -> WordCard:
    return WordCard(
        id=uuid.UUID(int=n),
        text=f"말씀 {n}",
        volume="천성경.pdf",
        chunk_id=f"chunk-{n}",
        chunk_index=n,
        work_title=work_title,
        source_label=f"{work_title} p.{n}",
        status=status,
        pinned_on=pinned_on,
        created_at=BASE + timedelta(minutes=n),
    )


# --- 단위: 회전 규칙 ----------------------------------------------------------


def test_pick_pinned_card_wins_over_rotation():
    cards = [make_card(1), make_card(2), make_card(3, pinned_on=TODAY)]
    assert pick_today_card(cards, TODAY).id == uuid.UUID(int=3)


def test_pick_ignores_draft_and_retired_even_when_pinned():
    cards = [make_card(1), make_card(2, status="draft", pinned_on=TODAY), make_card(3, status="retired")]
    # 고정 카드가 draft 면 회전으로 넘어가고, 풀은 active 1장뿐이다
    assert pick_today_card(cards, TODAY).id == uuid.UUID(int=1)


def test_pick_empty_pool_returns_none():
    assert pick_today_card([], TODAY) is None
    assert pick_today_card([make_card(1, status="draft"), make_card(2, status="retired")], TODAY) is None


def test_pick_rotates_by_ordinal_mod_pool_size_in_stable_order():
    # 입력 순서를 뒤섞어도 (created_at, id) 정렬 기준이라 결과가 같다
    cards = [make_card(3), make_card(1), make_card(2)]
    expected = sorted(cards, key=lambda c: c.created_at)[TODAY.toordinal() % 3]
    assert pick_today_card(cards, TODAY) is expected
    assert pick_today_card(list(reversed(cards)), TODAY) is expected


def test_pick_changes_by_day_and_wraps_at_pool_size():
    cards = [make_card(i) for i in range(1, 4)]
    picks = [pick_today_card(cards, TODAY + timedelta(days=d)).id for d in range(4)]
    assert len(set(picks[:3])) == 3  # 사흘 동안 서로 다른 카드
    assert picks[3] == picks[0]  # 풀 크기(3)만큼 지나면 처음으로 돌아온다


def test_pick_same_created_at_falls_back_to_id():
    a, b = make_card(1), make_card(2)
    b.created_at = a.created_at
    day = date.fromordinal(TODAY.toordinal() - TODAY.toordinal() % 2)  # ordinal % 2 == 0
    assert pick_today_card([b, a], day).id == uuid.UUID(int=1)


# --- 통합: 라우터 ------------------------------------------------------------


@pytest.fixture
async def ctx():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[User.__table__, WordCard.__table__, CardReceipt.__table__, AdminAuditLog.__table__],
        )
    session = AsyncSession(engine, expire_on_commit=False)
    repo = CardRepository(session)
    users = UserRepository(session)
    app.dependency_overrides[get_card_service] = lambda: CardService(repo, today_fn=lambda: TODAY)
    app.dependency_overrides[get_card_admin_service] = lambda: CardAdminService(repo)
    app.dependency_overrides[get_identity_repository] = lambda: users
    app.dependency_overrides[get_admin_service] = lambda: AdminService(AdminRepository(session))
    app.dependency_overrides[get_current_admin] = lambda: {
        "user_id": uuid.uuid4(),
        "email": settings.demo_admin_email,
    }
    client = TestClient(app)
    client.session = session  # type: ignore[attr-defined]
    client.users = users  # type: ignore[attr-defined]
    try:
        yield client
    finally:
        for provider in (
            get_card_service,
            get_card_admin_service,
            get_identity_repository,
            get_admin_service,
            get_current_admin,
        ):
            app.dependency_overrides.pop(provider, None)
        await session.close()
        await engine.dispose()


async def add(client: TestClient, *cards: WordCard) -> None:
    session: AsyncSession = client.session  # type: ignore[attr-defined]
    session.add_all(cards)
    await session.commit()


async def login(client: TestClient, email: str = "reader@example.com") -> User:
    from app.modules.identity.schemas import SignupRequest

    user = await IdentityService(client.users).signup(  # type: ignore[attr-defined]
        SignupRequest(email=email, password="password1", display_name="식구")
    )
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(user))
    return user


@pytest.mark.asyncio
async def test_today_empty_pool_is_200_with_null_card(ctx: TestClient):
    await add(ctx, make_card(1, status="draft"))
    res = ctx.get("/hoondok/cards/today")
    assert res.status_code == 200
    assert res.json() == {"date": TODAY.isoformat(), "card": None}


@pytest.mark.asyncio
async def test_today_returns_pinned_card_with_source_link_fields(ctx: TestClient):
    await add(ctx, make_card(1), make_card(2, pinned_on=TODAY))
    card = ctx.get("/hoondok/cards/today").json()["card"]
    assert card["id"] == str(uuid.UUID(int=2))
    assert {card["volume"], card["chunk_id"], card["chunk_index"]} == {"천성경.pdf", "chunk-2", 2}
    assert "status" not in card and "pinned_on" not in card  # 공개 응답에 운영 필드 없음


@pytest.mark.asyncio
async def test_public_card_hides_draft_and_retired(ctx: TestClient):
    await add(ctx, make_card(1), make_card(2, status="draft"), make_card(3, status="retired"))
    assert ctx.get(f"/hoondok/cards/{uuid.UUID(int=1)}").status_code == 200
    assert ctx.get(f"/hoondok/cards/{uuid.UUID(int=2)}").status_code == 404
    assert ctx.get(f"/hoondok/cards/{uuid.UUID(int=3)}").status_code == 404
    assert ctx.get(f"/hoondok/cards/{uuid.uuid4()}").status_code == 404
    # 받기·건넴도 비공개 카드는 404
    await login(ctx)
    assert ctx.post(f"/hoondok/me/cards/{uuid.UUID(int=2)}/receive", headers=XHR).status_code == 404
    assert ctx.post(f"/hoondok/me/cards/{uuid.UUID(int=3)}/shared", headers=XHR).status_code == 404


@pytest.mark.asyncio
async def test_receive_is_idempotent(ctx: TestClient):
    await add(ctx, make_card(1))
    await login(ctx)
    url = f"/hoondok/me/cards/{uuid.UUID(int=1)}/receive"
    first = ctx.post(url, headers=XHR)
    second = ctx.post(url, headers=XHR)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert first.json()["received_on"] == TODAY.isoformat() and first.json()["shared_at"] is None
    rows = (await ctx.session.execute(select(CardReceipt))).scalars().all()  # type: ignore[attr-defined]
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_shared_creates_receipt_and_keeps_first_time(ctx: TestClient):
    await add(ctx, make_card(1))
    await login(ctx)
    url = f"/hoondok/me/cards/{uuid.UUID(int=1)}/shared"
    first = ctx.post(url, headers=XHR).json()
    second = ctx.post(url, headers=XHR).json()
    assert first["shared_at"] is not None
    assert second["shared_at"] == first["shared_at"]  # 처음 건넨 시각 유지
    # 받기를 나중에 불러도 건넴 표시는 지워지지 않는다
    after = ctx.post(f"/hoondok/me/cards/{uuid.UUID(int=1)}/receive", headers=XHR).json()
    assert after["shared_at"] == first["shared_at"]
    rows = (await ctx.session.execute(select(CardReceipt))).scalars().all()  # type: ignore[attr-defined]
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_shared_after_receive_sets_shared_at(ctx: TestClient):
    await add(ctx, make_card(1))
    await login(ctx)
    ctx.post(f"/hoondok/me/cards/{uuid.UUID(int=1)}/receive", headers=XHR)
    shared = ctx.post(f"/hoondok/me/cards/{uuid.UUID(int=1)}/shared", headers=XHR).json()
    assert shared["shared_at"] is not None and shared["received_on"] == TODAY.isoformat()


@pytest.mark.asyncio
async def test_me_cards_groups_by_work_title_and_filters_shared(ctx: TestClient):
    await add(
        ctx,
        make_card(1),
        make_card(2),
        make_card(3, work_title="평화경"),
        make_card(4, work_title="원리강론"),
    )
    me = await login(ctx)
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    # 받은 날이 서로 다른 기록 — 최신순 정렬 확인용
    for n, day in ((1, TODAY - timedelta(days=3)), (2, TODAY - timedelta(days=1)), (3, TODAY - timedelta(days=2))):
        session.add(CardReceipt(user_id=me.id, card_id=uuid.UUID(int=n), received_on=day))
    await session.commit()
    ctx.post(f"/hoondok/me/cards/{uuid.UUID(int=4)}/shared", headers=XHR)  # 오늘 건넴(받기 포함)

    body = ctx.get("/hoondok/me/cards").json()
    assert body["shelves"] == [
        {"work_title": "천성경", "count": 2},
        {"work_title": "원리강론", "count": 1},
        {"work_title": "평화경", "count": 1},
    ]
    assert [i["card"]["id"] for i in body["items"]] == [str(uuid.UUID(int=n)) for n in (4, 2, 3, 1)]

    shared = ctx.get("/hoondok/me/cards?filter=shared").json()
    assert shared["shelves"] == [{"work_title": "원리강론", "count": 1}]
    assert [i["card"]["id"] for i in shared["items"]] == [str(uuid.UUID(int=4))]
    assert ctx.get("/hoondok/me/cards?filter=nope").status_code == 422


@pytest.mark.asyncio
async def test_me_cards_is_per_user_and_requires_login_and_csrf(ctx: TestClient):
    await add(ctx, make_card(1))
    assert ctx.get("/hoondok/me/cards").status_code == 401
    assert ctx.post(f"/hoondok/me/cards/{uuid.UUID(int=1)}/receive", headers=XHR).status_code == 401
    await login(ctx, "other@example.com")
    ctx.post(f"/hoondok/me/cards/{uuid.UUID(int=1)}/receive", headers=XHR)
    await login(ctx, "me@example.com")
    assert ctx.post(f"/hoondok/me/cards/{uuid.UUID(int=1)}/receive").status_code == 403  # CSRF 헤더 없음
    assert ctx.get("/hoondok/me/cards").json() == {"shelves": [], "items": []}


# --- API-HD-052 admin --------------------------------------------------------


def card_body(**overrides) -> dict:
    body = {
        "text": "원문 그대로의 말씀",
        "volume": "천성경.pdf",
        "chunk_id": "chunk-9",
        "chunk_index": 9,
        "work_title": "천성경",
        "source_label": "천성경 p.9",
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_admin_create_list_and_status_filter(ctx: TestClient):
    created = ctx.post("/admin/hoondok/cards", json=card_body(), headers=XHR)
    assert created.status_code == 201 and created.json()["status"] == "draft"
    ctx.post("/admin/hoondok/cards", json=card_body(chunk_id="c-2", status="active"), headers=XHR)

    listed = ctx.get("/admin/hoondok/cards?status=draft").json()
    assert listed["total"] == 1 and listed["items"][0]["id"] == created.json()["id"]
    page = ctx.get("/admin/hoondok/cards?page=2&page_size=1").json()
    assert page["total"] == 2 and len(page["items"]) == 1 and page["page"] == 2
    audit = (await ctx.session.execute(select(AdminAuditLog))).scalars().all()  # type: ignore[attr-defined]
    assert [a.action for a in audit] == ["word_card.create", "word_card.create"]


@pytest.mark.asyncio
async def test_admin_pinned_on_conflict_is_409(ctx: TestClient):
    await add(ctx, make_card(1, pinned_on=TODAY), make_card(2))
    assert ctx.post("/admin/hoondok/cards", json=card_body(pinned_on=TODAY.isoformat()), headers=XHR).status_code == 409
    res = ctx.patch(f"/admin/hoondok/cards/{uuid.UUID(int=2)}", json={"pinned_on": TODAY.isoformat()}, headers=XHR)
    assert res.status_code == 409
    # 같은 카드에 같은 날짜를 다시 보내는 것은 충돌이 아니다
    same = ctx.patch(f"/admin/hoondok/cards/{uuid.UUID(int=1)}", json={"pinned_on": TODAY.isoformat()}, headers=XHR)
    assert same.status_code == 200


@pytest.mark.asyncio
async def test_admin_patch_status_and_unpin_but_rejects_text(ctx: TestClient):
    await add(ctx, make_card(1, status="draft", pinned_on=TODAY))
    url = f"/admin/hoondok/cards/{uuid.UUID(int=1)}"
    assert ctx.patch(url, json={"text": "고친 말씀"}, headers=XHR).status_code == 422
    assert ctx.patch(url, json={"status": "active", "text": "고친 말씀"}, headers=XHR).status_code == 422
    assert ctx.patch(url, json={"status": None}, headers=XHR).status_code == 422

    res = ctx.patch(url, json={"status": "active", "pinned_on": None}, headers=XHR)
    assert res.status_code == 200
    assert res.json()["status"] == "active" and res.json()["pinned_on"] is None
    assert res.json()["text"] == "말씀 1"  # 원문 불변
    assert ctx.patch(f"/admin/hoondok/cards/{uuid.uuid4()}", json={"status": "retired"}, headers=XHR).status_code == 404


@pytest.mark.asyncio
async def test_delete_for_user_removes_only_own_receipts(ctx: TestClient):
    """계정 삭제 purger(API-HD-011) — 본인 책갈피만 지운다. 커밋은 사용자 저장이 한다."""
    await add(ctx, make_card(1))
    me = await login(ctx, "me@example.com")
    other = await login(ctx, "other@example.com")
    session: AsyncSession = ctx.session  # type: ignore[attr-defined]
    session.add_all(
        [
            CardReceipt(user_id=me.id, card_id=uuid.UUID(int=1), received_on=TODAY),
            CardReceipt(user_id=other.id, card_id=uuid.UUID(int=1), received_on=TODAY),
        ]
    )
    await session.commit()
    await CardRepository(session).delete_for_user(me.id)
    await session.commit()
    rows = (await session.execute(select(CardReceipt))).scalars().all()
    assert [r.user_id for r in rows] == [other.id]


def test_admin_card_routes_require_csrf():
    """관리자 쓰기는 라우터 레벨 verify_csrf — 헤더 없으면 403."""
    from app.modules.admin.dependencies import verify_csrf
    from app.modules.hoondok.cards_admin_router import cards_admin_router

    assert any(d.dependency is verify_csrf for d in cards_admin_router.dependencies)
