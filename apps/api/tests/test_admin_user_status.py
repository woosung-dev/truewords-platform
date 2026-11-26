"""관리자 계정 활성/비활성 전환 (PATCH /admin/users/{id}/status).

체험단처럼 한시적으로 발급한 계정의 접근을 계정 삭제 없이 종료하기 위한 기능.
"""

import uuid

import pytest

from route_helpers import dependency_callables, iter_api_routes
from fastapi import HTTPException
from unittest.mock import AsyncMock, MagicMock, patch

from app.modules.admin.dependencies import get_current_admin, require_admin_gate, verify_csrf
from app.modules.admin.service import AdminService


def _make_user(is_active: bool = True, email: str = "trial@example.com"):
    user = MagicMock()
    user.id = uuid.uuid4()
    user.email = email
    user.role = "admin"
    user.is_active = is_active
    return user


def _make_repo(user=None):
    repo = MagicMock()
    repo.get_user_by_id = AsyncMock(return_value=user)
    repo.commit = AsyncMock()

    async def _set_active(u, is_active):
        u.is_active = is_active
        return u

    repo.set_user_active = AsyncMock(side_effect=_set_active)
    return repo


# --- Service 규칙 ---


@pytest.mark.asyncio
async def test_deactivate_flips_is_active_and_commits():
    user = _make_user(is_active=True)
    repo = _make_repo(user)

    result, changed = await AdminService(repo).set_admin_active(
        user_id=user.id, is_active=False, actor_id=uuid.uuid4()
    )

    assert result.is_active is False
    assert changed is True
    repo.set_user_active.assert_awaited_once_with(user, False)
    repo.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_reactivate_flips_back():
    """활성화는 되돌리기 경로 — 같은 endpoint 로 복구 가능해야 한다."""
    user = _make_user(is_active=False)
    repo = _make_repo(user)

    result, changed = await AdminService(repo).set_admin_active(
        user_id=user.id, is_active=True, actor_id=uuid.uuid4()
    )

    assert result.is_active is True
    assert changed is True


@pytest.mark.asyncio
async def test_cannot_deactivate_self_400():
    """자기 계정 비활성화 금지 — 스스로를 잠그면 UI 로 되돌릴 수 없다."""
    actor_id = uuid.uuid4()
    repo = _make_repo(_make_user(is_active=True))

    with pytest.raises(HTTPException) as exc_info:
        await AdminService(repo).set_admin_active(
            user_id=actor_id, is_active=False, actor_id=actor_id
        )

    assert exc_info.value.status_code == 400
    # 계정을 조회하기도 전에 거부 → 부수효과 없음
    repo.set_user_active.assert_not_awaited()
    repo.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_can_reactivate_self():
    """비활성화만 금지 대상 — 자기 계정 '활성화' 는 잠금 위험이 없어 허용."""
    actor_id = uuid.uuid4()
    user = _make_user(is_active=False)
    user.id = actor_id
    repo = _make_repo(user)

    _, changed = await AdminService(repo).set_admin_active(
        user_id=actor_id, is_active=True, actor_id=actor_id
    )

    assert changed is True


@pytest.mark.asyncio
async def test_unknown_user_404():
    repo = _make_repo(None)

    with pytest.raises(HTTPException) as exc_info:
        await AdminService(repo).set_admin_active(
            user_id=uuid.uuid4(), is_active=False, actor_id=uuid.uuid4()
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_same_value_is_idempotent_no_write():
    """이미 비활성인 계정을 다시 비활성화 → 쓰기·커밋 없음, changed=False.

    중복 클릭이나 stale 화면 요청이 감사 로그를 오염시키지 않도록 하는 잠금.
    """
    user = _make_user(is_active=False)
    repo = _make_repo(user)

    result, changed = await AdminService(repo).set_admin_active(
        user_id=user.id, is_active=False, actor_id=uuid.uuid4()
    )

    assert changed is False
    assert result.is_active is False
    repo.set_user_active.assert_not_awaited()
    repo.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_status_change_and_audit_commit_once_together():
    """상태 변경을 먼저 commit 하면 감사 기록 실패 시 변경만 남는다.

    상태 전환은 flush 만 하고, 감사 insert 뒤의 commit 한 번으로 함께 확정한다.
    """
    user = _make_user(is_active=True)
    repo = _make_repo(user)
    calls: list[str] = []
    repo.set_user_active = AsyncMock(side_effect=lambda u, v: calls.append("set_active") or u)
    repo.create_audit_log = AsyncMock(side_effect=lambda log: calls.append("audit") or log)
    repo.commit = AsyncMock(side_effect=lambda: calls.append("commit"))
    actor_id = uuid.uuid4()

    result = await AdminService(repo).set_admin_active_with_audit(
        user_id=user.id, is_active=False, actor_id=actor_id, ip_address="127.0.0.1"
    )

    assert result is user
    assert calls == ["set_active", "audit", "commit"]
    log = repo.create_audit_log.await_args.args[0]
    assert log.action == "admin_user.deactivate"
    assert log.admin_user_id == actor_id
    assert log.target_id == user.id


@pytest.mark.asyncio
async def test_status_change_rolls_back_when_audit_fails():
    user = _make_user(is_active=True)
    repo = _make_repo(user)
    repo.create_audit_log = AsyncMock(side_effect=RuntimeError("audit failure"))
    repo.rollback = AsyncMock()

    with pytest.raises(RuntimeError, match="audit failure"):
        await AdminService(repo).set_admin_active_with_audit(
            user_id=user.id, is_active=False, actor_id=uuid.uuid4()
        )

    repo.commit.assert_not_awaited()
    repo.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_status_unchanged_writes_no_audit():
    """멱등 요청(이미 같은 값)은 감사 로그도 commit 도 남기지 않는다."""
    user = _make_user(is_active=False)
    repo = _make_repo(user)
    repo.create_audit_log = AsyncMock()

    await AdminService(repo).set_admin_active_with_audit(
        user_id=user.id, is_active=False, actor_id=uuid.uuid4()
    )

    repo.create_audit_log.assert_not_awaited()
    repo.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_admin_records_audit_without_password():
    from app.modules.admin.schemas import CreateAdminRequest

    repo = MagicMock()
    repo.get_user_by_email = AsyncMock(return_value=None)
    calls: list[str] = []
    repo.create_user = AsyncMock(side_effect=lambda u: calls.append("create") or u)
    repo.create_audit_log = AsyncMock(side_effect=lambda log: calls.append("audit") or log)
    repo.commit = AsyncMock(side_effect=lambda: calls.append("commit"))

    user = await AdminService(repo).create_admin_with_audit(
        CreateAdminRequest(email="new@example.com", password="secret-pw", role="admin"),
        actor_id=uuid.uuid4(),
    )

    assert calls == ["create", "audit", "commit"]
    log = repo.create_audit_log.await_args.args[0]
    assert log.action == "admin_user.create"
    assert log.target_id == user.id
    assert log.changes == {"email": "new@example.com", "role": "admin"}
    assert "secret-pw" not in str(log.changes)


# --- 비활성 계정은 로그인 불가 (차단이 실제로 성립하는지) ---


@pytest.mark.asyncio
async def test_inactive_account_cannot_login_403():
    """비밀번호가 맞아도 is_active=False 면 403.

    이 잠금이 없으면 '비활성화' 가 접근 차단으로 이어지지 않는다.
    """
    from app.modules.admin.auth import hash_password
    from app.modules.admin.schemas import AdminLoginRequest

    user = _make_user(is_active=False)
    user.hashed_password = hash_password("pw12345")
    repo = MagicMock()
    repo.get_user_by_email = AsyncMock(return_value=user)

    with pytest.raises(HTTPException) as exc_info:
        await AdminService(repo).login(
            AdminLoginRequest(email=user.email, password="pw12345")
        )

    assert exc_info.value.status_code == 403


# --- 라우터 배선 ---


def test_status_route_requires_csrf_and_admin_gate():
    """상태 변경은 CSRF + 관리자 게이트 둘 다 필수."""
    with patch("app.main.init_db", new_callable=AsyncMock):
        from app.main import app

    target, inherited = next(
        (route, inherited)
        for route, inherited in iter_api_routes(app)
        if getattr(route, "path", None) == "/admin/users/{user_id}/status"
        and "PATCH" in (getattr(route, "methods", None) or set())
    )
    dep_callables = dependency_callables(target, inherited)

    assert verify_csrf in dep_callables, "상태 변경 route 에 verify_csrf 누락"
    assert require_admin_gate in dep_callables, "상태 변경 route 에 require_admin_gate 누락"


@pytest.mark.asyncio
async def test_status_endpoint_returns_updated_state():
    """endpoint 응답이 변경된 상태를 그대로 반영 — 프론트 낙관적 갱신의 계약."""
    from datetime import datetime, timezone

    from httpx import ASGITransport, AsyncClient

    from app.modules.admin.dependencies import get_admin_service

    target_id = uuid.uuid4()
    updated = MagicMock()
    updated.id = target_id
    updated.email = "trial@example.com"
    updated.role = "admin"
    updated.is_active = False
    updated.created_at = datetime(2026, 7, 7, 9, 0, 0, tzinfo=timezone.utc)

    service = MagicMock()
    service.set_admin_active_with_audit = AsyncMock(return_value=updated)

    with patch("app.main.init_db", new_callable=AsyncMock):
        from app.main import app

    app.dependency_overrides[get_current_admin] = lambda: {
        "user_id": uuid.uuid4(),
        "role": "admin",
        "email": "demo-admin@example.com",
    }
    app.dependency_overrides[get_admin_service] = lambda: service
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.patch(
                f"/admin/users/{target_id}/status",
                json={"is_active": False},
                headers={"X-Requested-With": "XMLHttpRequest"},
            )
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
        app.dependency_overrides.pop(get_admin_service, None)

    assert res.status_code == 200
    assert res.json()["is_active"] is False
    # 상태 전환과 감사 기록은 서비스의 한 트랜잭션에서 처리한다
    service.set_admin_active_with_audit.assert_awaited_once()
    kwargs = service.set_admin_active_with_audit.await_args.kwargs
    assert kwargs["user_id"] == target_id
    assert kwargs["is_active"] is False
