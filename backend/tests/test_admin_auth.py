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
from src.admin.dependencies import get_current_admin, verify_csrf, COOKIE_NAME


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
    data = {"sub": "user-123", "role": "admin"}
    token = create_access_token(data)
    decoded = decode_access_token(token)

    assert decoded is not None
    assert decoded["sub"] == "user-123"
    assert decoded["role"] == "admin"
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
    token = create_access_token({"sub": user_id, "role": "admin"})
    request = _make_request(cookies={COOKIE_NAME: token})

    result = await get_current_admin(request)

    assert result["user_id"] == uuid.UUID(user_id)
    assert result["role"] == "admin"


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
