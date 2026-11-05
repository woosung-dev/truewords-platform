"""관리자 JWT 인증 유틸리티."""

import secrets
from datetime import timedelta
from functools import cache

import bcrypt
from jose import JWTError, jwt

from app.core.common.clock import utcnow
from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


@cache
def _dummy_hash() -> str:
    """없는 계정 비교용 해시. 같은 cost 로 만들어 있는 계정과 응답 시간이 같아지게 한다."""
    return hash_password(secrets.token_urlsafe(16))


def verify_login_password(plain: str, hashed: str | None) -> bool:
    """로그인 비밀번호 검사. 계정이 없어도(hashed=None) bcrypt 를 한 번 돌려 시간으로 가입 여부가 드러나지 않게 한다."""
    if hashed is None:
        verify_password(plain, _dummy_hash())
        return False
    return verify_password(plain, hashed)


def create_access_token(data: dict, expires_minutes: int | None = None) -> str:
    """기본 만료는 admin 값. 훈독(identity)은 expires_minutes 로 7일을 넘긴다."""
    to_encode = data.copy()
    expire = utcnow() + timedelta(
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
