"""관리자 JWT 인증 유틸리티."""

from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(data: dict, expires_minutes: int | None = None) -> str:
    """기본 만료는 admin 값. 훈독(identity)은 expires_minutes 로 7일을 넘긴다."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes if expires_minutes is not None else settings.admin_jwt_expire_minutes
    )
    to_encode["exp"] = expire
    return jwt.encode(
        to_encode,
        settings.admin_jwt_secret.get_secret_value(),
        algorithm=settings.admin_jwt_algorithm,
    )


def decode_access_token(token: str, audience: str | None = None) -> dict | None:
    """audience=None(admin) 이면 jose 가 aud 가 있는 토큰을 거부한다 — 훈독 토큰은 admin 에 못 쓴다.

    반대로 audience 를 넘겨도 aud 가 **없는** 토큰은 jose 가 통과시키므로 호출자가 aud 를 재검사해야 한다.
    """
    try:
        return jwt.decode(
            token,
            settings.admin_jwt_secret.get_secret_value(),
            algorithms=[settings.admin_jwt_algorithm],
            audience=audience,
        )
    except JWTError:
        return None
