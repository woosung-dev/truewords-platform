"""훈독 identity Service — 가입·로그인·토큰 발급 · 제한 베타 초대 코드 게이트 · 계정 삭제(API-HD-011)."""

import secrets
import uuid
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Protocol

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.modules.admin.auth import create_access_token, hash_password, verify_password
from app.modules.identity.exceptions import InviteRequiredError
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.schemas import LoginRequest, SignupRequest, UserPublic

AUDIENCE = "hoondok"
# 이메일 존재 여부를 구분하지 않는다 (API-HD-003).
_INVALID_CREDENTIALS = "이메일 또는 비밀번호가 올바르지 않습니다"


def required_invite_code() -> str | None:
    """HOONDOK_INVITE_CODE 가 설정돼 있으면 그 값, 미설정·빈 값이면 None(게이트 OFF).

    `HOONDOK_INVITE_CODE=` 처럼 빈 env 는 None 이 아니라 SecretStr("") 로 들어오므로 값을 보고 판단한다.
    """
    code = settings.hoondok_invite_code
    value = code.get_secret_value().strip() if code is not None else ""
    return value or None


def check_invite_code(provided: str | None) -> None:
    """게이트 ON 이면 누락·불일치를 InviteRequiredError(403) 로. 바이트 상수 시간 비교 — 한글 코드도 TypeError 없이."""
    expected = required_invite_code()
    if expected is None:
        return
    given = (provided or "").strip()
    if not given or not secrets.compare_digest(given.encode("utf-8"), expected.encode("utf-8")):
        raise InviteRequiredError()


class UserDataPurger(Protocol):
    """계정 삭제 시 함께 지울 사용자 데이터 저장소(hoondok 의 mission_logs·jeongseong_periods 리포).

    identity 는 hoondok 을 import 하지 않는다 — 구체 리포는 identity/dependencies.py 의 DI 가 주입한다.
    구현은 커밋하지 않고, 같은 세션의 UserRepository.save 커밋에 묶인다.
    """

    async def delete_for_user(self, user_id: uuid.UUID) -> None: ...


class IdentityService:
    def __init__(self, repo: UserRepository) -> None:
        self.repo = repo

    async def signup(self, data: SignupRequest) -> User:
        # 게이트를 중복 검사보다 먼저 — 초대받지 않은 요청에 이메일 존재 여부(409)를 알리지 않는다
        check_invite_code(data.invite_code)
        if await self.repo.get_by_email(data.email):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 등록된 이메일입니다")
        user = User(
            email=data.email,
            password_hash=hash_password(data.password),
            display_name=data.display_name.strip(),
        )
        try:
            return await self.repo.create(user)
        except IntegrityError:
            # 동시 가입 경쟁 — unique 제약이 잡은 경우도 같은 409.
            await self.repo.session.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 등록된 이메일입니다")

    async def login(self, data: LoginRequest) -> User:
        user = await self.repo.get_by_email(data.email)
        if user is None or user.deleted_at is not None or not verify_password(data.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID_CREDENTIALS)
        return user

    async def delete_account(self, user: User, purgers: Sequence[UserDataPurger]) -> None:
        """API-HD-011 "내 데이터 삭제 — 기록을 모두 지워요".

        훈독 기록은 하드 삭제, 계정은 deleted_at 소프트 삭제 + 이메일을 `deleted:{id}` 로 익명화해 같은 주소로
        다시 가입할 수 있게 한다(unique 인덱스 충돌 없음). 발급된 쿠키는 get_optional_user 가 deleted_at 으로 거른다.
        """
        for purger in purgers:
            await purger.delete_for_user(user.id)
        user.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        user.email = f"deleted:{user.id}"
        await self.repo.save(user)  # 한 번의 커밋 — purger 의 DELETE 도 같은 세션에서 함께 반영된다

    @staticmethod
    def issue_token(user: User) -> str:
        """JWT aud="hoondok". admin 디코더는 aud 가 있는 토큰을 거부하므로 admin API 에 쓸 수 없다."""
        return create_access_token(
            {"sub": str(user.id), "aud": AUDIENCE},
            expires_minutes=settings.hoondok_jwt_expire_minutes,
        )

    @staticmethod
    def to_public(user: User) -> UserPublic:
        return UserPublic(id=user.id, email=user.email, display_name=user.display_name)
