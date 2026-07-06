"""관리자 인증 유틸리티 + Cookie/CSRF 테스트."""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.admin.auth import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
)
from src.admin.dependencies import (
    COOKIE_NAME,
    DEMO_ADMIN_EMAIL,
    get_current_admin,
    require_admin_gate,
    verify_csrf,
)


# --- 기존 유틸리티 테스트 ---


def test_hash_password_creates_bcrypt_hash():
    hashed = hash_password("test1234")
    assert hashed != "test1234"
    assert hashed.startswith("$2b$")


def test_verify_password_correct():
    hashed = hash_password("mypassword")
    assert verify_password("mypassword", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("mypassword")
    assert verify_password("wrongpassword", hashed) is False


def test_create_and_decode_access_token():
    data = {"sub": "user-123", "role": "admin", "email": "admin@test.com"}
    token = create_access_token(data)
    decoded = decode_access_token(token)

    assert decoded is not None
    assert decoded["sub"] == "user-123"
    assert decoded["role"] == "admin"
    assert decoded["email"] == "admin@test.com"
    assert "exp" in decoded


def test_decode_invalid_token_returns_none():
    result = decode_access_token("invalid.jwt.token")
    assert result is None


def test_decode_empty_token_returns_none():
    result = decode_access_token("")
    assert result is None


# --- Cookie 기반 인증 테스트 ---


def _make_request(cookies=None, method="GET", headers=None):
    """테스트용 Request mock."""
    request = MagicMock()
    request.cookies = cookies or {}
    request.method = method
    request.headers = headers or {}
    return request


@pytest.mark.asyncio
async def test_get_current_admin_from_cookie():
    user_id = str(uuid.uuid4())
    token = create_access_token(
        {"sub": user_id, "role": "admin", "email": "admin@test.com"}
    )
    request = _make_request(cookies={COOKIE_NAME: token})

    result = await get_current_admin(request)

    assert result["user_id"] == uuid.UUID(user_id)
    assert result["role"] == "admin"
    assert result["email"] == "admin@test.com"


@pytest.mark.asyncio
async def test_get_current_admin_old_token_without_email_claim():
    """email claim 없는 구 토큰 → email None (하위 호환 잠금)."""
    token = create_access_token({"sub": str(uuid.uuid4()), "role": "admin"})
    request = _make_request(cookies={COOKIE_NAME: token})

    result = await get_current_admin(request)

    assert result["email"] is None


@pytest.mark.asyncio
async def test_get_current_admin_no_cookie_returns_401():
    from fastapi import HTTPException

    request = _make_request(cookies={})
    with pytest.raises(HTTPException) as exc_info:
        await get_current_admin(request)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_admin_invalid_token_returns_401():
    from fastapi import HTTPException

    request = _make_request(cookies={COOKIE_NAME: "invalid.jwt.token"})
    with pytest.raises(HTTPException) as exc_info:
        await get_current_admin(request)
    assert exc_info.value.status_code == 401


# --- CSRF 검증 테스트 ---


@pytest.mark.asyncio
async def test_verify_csrf_get_request_passes():
    """GET 요청은 CSRF 검증 불필요."""
    request = _make_request(method="GET")
    await verify_csrf(request)


@pytest.mark.asyncio
async def test_verify_csrf_post_with_header_passes():
    """POST + X-Requested-With 헤더 있으면 통과."""
    request = _make_request(
        method="POST",
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    await verify_csrf(request)


@pytest.mark.asyncio
async def test_verify_csrf_post_without_header_fails():
    """POST + X-Requested-With 헤더 없으면 403."""
    from fastapi import HTTPException

    request = _make_request(method="POST", headers={})
    with pytest.raises(HTTPException) as exc_info:
        await verify_csrf(request)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_verify_csrf_put_without_header_fails():
    """PUT + X-Requested-With 헤더 없으면 403."""
    from fastapi import HTTPException

    request = _make_request(method="PUT", headers={})
    with pytest.raises(HTTPException) as exc_info:
        await verify_csrf(request)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_verify_csrf_delete_with_header_passes():
    """DELETE + X-Requested-With 헤더 있으면 통과."""
    request = _make_request(
        method="DELETE",
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    await verify_csrf(request)


@pytest.mark.asyncio
async def test_verify_csrf_patch_without_header_fails():
    """audit 2차 C-2 (2026-05-15): PATCH 요청도 CSRF 검증 대상.

    기존 verify_csrf 는 POST/PUT/DELETE 만 검사해서 data_router 의
    /display-name PATCH 가 무방비. 본 회귀 잠금.
    """
    from fastapi import HTTPException

    request = _make_request(method="PATCH", headers={})
    with pytest.raises(HTTPException) as exc_info:
        await verify_csrf(request)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_verify_csrf_patch_with_header_passes():
    """PATCH + X-Requested-With 헤더 있으면 통과."""
    request = _make_request(
        method="PATCH",
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    await verify_csrf(request)


# --- 시연 한시 관리자 게이트 테스트 (ponytail: 시연 종료 후 게이트와 함께 삭제) ---


@pytest.mark.asyncio
async def test_require_admin_gate_passes_for_demo_admin_case_insensitive():
    """하드코딩 관리자 이메일은 대소문자 무관 통과."""
    current = {"user_id": uuid.uuid4(), "role": "admin", "email": "JangWooSeng97@Gmail.com"}
    result = await require_admin_gate(current)
    assert result is current


@pytest.mark.asyncio
async def test_require_admin_gate_rejects_other_email_403():
    from fastapi import HTTPException

    current = {"user_id": uuid.uuid4(), "role": "admin", "email": "admin@test.com"}
    with pytest.raises(HTTPException) as exc_info:
        await require_admin_gate(current)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_admin_gate_rejects_missing_email_403():
    """email claim 없는 구 토큰(None)도 403 — 재로그인 유도."""
    from fastapi import HTTPException

    current = {"user_id": uuid.uuid4(), "role": "admin", "email": None}
    with pytest.raises(HTTPException) as exc_info:
        await require_admin_gate(current)
    assert exc_info.value.status_code == 403


def test_admin_gate_route_wiring():
    """게이트 과차단/미차단 동시 방지 잠금.

    - 게이트 대상: admin 관리 route + admin 전용 라우터 4종 대표 경로.
    - 게이트 제외: /admin/auth/* (채팅 AuthGuard 가 me 사용), 공개 chat/chatbots,
      원문보기 chunks (자체 chatbot ACL).
    """
    with patch("main.init_db", new_callable=AsyncMock):
        from main import app

    def _has_gate(route) -> bool:
        return any(
            d.call is require_admin_gate for d in route.dependant.dependencies
        )

    gated = {
        ("/admin/users", "POST"),
        ("/admin/audit-logs", "GET"),
        ("/admin/settings/config", "GET"),
        ("/admin/analytics/dashboard-summary", "GET"),
        ("/admin/data-sources/status", "GET"),
        ("/admin/data-source-categories", "GET"),
        ("/admin/chatbot-configs", "GET"),
    }
    open_paths = {
        ("/admin/auth/login", "POST"),
        ("/admin/auth/logout", "POST"),
        ("/admin/auth/me", "GET"),
        ("/chatbots", "GET"),
        ("/chat", "POST"),
        ("/api/sources/chunks/{chunk_id}", "GET"),
    }

    seen: set[tuple[str, str]] = set()
    for route in app.routes:
        methods = getattr(route, "methods", None)
        path = getattr(route, "path", None)
        if not methods or path is None:
            continue
        for method in methods:
            key = (path, method)
            if key in gated:
                seen.add(key)
                assert _has_gate(route), f"{key} 에 require_admin_gate 누락"
            elif key in open_paths:
                seen.add(key)
                assert not _has_gate(route), f"{key} 가 게이트에 과차단됨"

    assert seen == gated | open_paths, f"검증 대상 경로 누락: {(gated | open_paths) - seen}"


def test_demo_admin_email_is_lowercase():
    """게이트 비교는 소문자 정규화 — 상수 자체가 소문자여야 함."""
    assert DEMO_ADMIN_EMAIL == DEMO_ADMIN_EMAIL.lower()


def test_data_router_applies_verify_csrf_at_router_level():
    """data_router 의 destructive endpoint 8건이 router-level verify_csrf 의존.

    audit 2차 C-2 잠금 — APIRouter dependencies 에서 verify_csrf 가 빠지면 본 test 실패.
    """
    from src.admin.data_router import router as data_router

    dep_callables = [d.dependency for d in data_router.dependencies]
    assert verify_csrf in dep_callables, (
        "data_router APIRouter dependencies 에 verify_csrf 누락 — destructive POST/"
        "PUT/PATCH/DELETE 8 routes 가 CSRF 무방비"
    )
