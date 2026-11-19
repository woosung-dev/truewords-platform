"""프로덕션은 비었거나 짧은 ADMIN_JWT_SECRET 으로 시작하지 않는다 — HS256 키 하나가 관리자 인증 전부다."""

from __future__ import annotations

import pytest
from pydantic import SecretStr

from app.core.config import Settings


def _prod(secret: str) -> Settings:
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        environment="production",
        admin_jwt_secret=SecretStr(secret),
        cookie_secure=True,
        gemini_api_key=SecretStr("k"),
    )


@pytest.mark.parametrize("secret", ["", "   ", "short-secret"])
def test_production_rejects_empty_or_short_jwt_secret(secret: str) -> None:
    with pytest.raises(ValueError, match="ADMIN_JWT_SECRET"):
        _prod(secret)


def test_production_accepts_long_jwt_secret() -> None:
    assert _prod("x" * 32).environment == "production"
