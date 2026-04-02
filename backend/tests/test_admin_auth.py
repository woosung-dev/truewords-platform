"""관리자 인증 유틸리티 테스트."""

from src.admin.auth import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
)


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
