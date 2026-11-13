"""훈독 identity Service — 로그인·토큰 발급 · 로그인 수단 관리 · 초대 코드 게이트 · 계정 삭제(API-HD-011).

이메일·비밀번호 가입은 닫혔다(410). 계정은 OAuth 콜백(oauth_service.py)에서만 만들어진다.
"""

import asyncio
import secrets
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from fastapi import HTTPException, status

from app.core.common.clock import utcnow
from app.core.config import settings
from app.modules.admin.auth import create_access_token, verify_login_password
from app.modules.identity.exceptions import IdentityError, InviteRequiredError
from app.modules.identity.models import User
from app.modules.identity.repository import UserIdentityRepository, UserRepository
from app.modules.identity.schemas import LoginMethod, LoginRequest, UserPublic

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


async def check_invite_code(provided: str | None) -> None:
    """게이트 ON 이면 누락·불일치를 InviteRequiredError(403) 로. 바이트 상수 시간 비교 — 한글 코드도 TypeError 없이."""
    expected = required_invite_code()
    if expected is None:
        return
    given = (provided or "").strip()
    if given and secrets.compare_digest(given.encode("utf-8"), expected.encode("utf-8")):
        return
    raise InviteRequiredError()


async def verify_reauth_password(user: User, password: str | None) -> None:
    """로그인 수단을 바꾸는 민감 작업 전 비밀번호 재확인. 없거나 틀리면 401 REAUTH_REQUIRED.

    bcrypt 는 로그인과 같은 방식으로 스레드에서 돌린다. 비밀번호가 없는(소셜 전용) 계정은 호출하지 않는다.
    """
    if not password or not user.password_hash:
        raise IdentityError(status.HTTP_401_UNAUTHORIZED, "REAUTH_REQUIRED", "비밀번호를 다시 확인해 주세요")
    try:
        ok = await asyncio.to_thread(verify_login_password, password, user.password_hash)
    except ValueError:
        ok = False  # bcrypt 는 72바이트 초과 입력에 예외를 낸다 — 500 이 아니라 불일치로 본다
    if not ok:
        raise IdentityError(status.HTTP_401_UNAUTHORIZED, "REAUTH_REQUIRED", "비밀번호를 다시 확인해 주세요")


@dataclass(frozen=True)
class AuthSession:
    """인증을 통과한 사용자와 그 요청 토큰의 sv.

    수단 변경 경로는 사용자 행을 잠근 직후 DB 값이 token_version 과 여전히 같은지 다시 확인해야 한다
    (인증 시점과 잠금 시점 사이에 다른 요청이 버전을 올렸을 수 있다).
    """

    user: User
    token_version: int


class UserDataPurger(Protocol):
    """계정 삭제 시 함께 지울 사용자 데이터 저장소(hoondok 의 mission_logs·jeongseong_periods 리포).

    identity service 는 hoondok 을 import 하지 않는다 — 구체 리포는 identity/dependencies.py 의 get_user_data_purgers 한 곳이 주입한다.
    구현은 커밋하지 않고, 같은 세션의 UserRepository.save 커밋에 묶인다.
    """

    async def delete_for_user(self, user_id: uuid.UUID) -> None: ...


class IdentityService:
    def __init__(self, repo: UserRepository, identities: UserIdentityRepository | None = None) -> None:
        self.repo = repo
        # 같은 세션을 공유한다 — 계정 삭제·로그인 수단 해제가 한 트랜잭션으로 묶인다.
        self.identities = identities or UserIdentityRepository(repo.session)

    async def login(self, data: LoginRequest) -> User:
        user = await self.repo.get_by_email(data.email)
        # 없는 계정도 bcrypt 를 돌려 응답 시간으로 가입 여부가 드러나지 않게 한다(API-HD-003).
        # bcrypt 는 CPU 를 오래 쓰므로 스레드에서 돌려 단일 워커 이벤트 루프를 막지 않는다.
        ok = await asyncio.to_thread(verify_login_password, data.password, user.password_hash if user is not None else None)
        if user is None or user.deleted_at is not None or not ok:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID_CREDENTIALS)
        return user

    async def delete_account(self, user: User, purgers: Sequence[UserDataPurger]) -> None:
        """API-HD-011 "내 데이터 삭제 — 기록을 모두 지워요".

        훈독 기록은 하드 삭제, 계정은 deleted_at 소프트 삭제 + 이메일을 `deleted:{id}` 로 익명화해 같은 주소로
        다시 가입할 수 있게 한다(unique 인덱스 충돌 없음). 발급된 쿠키는 get_optional_user 가 deleted_at 으로 거른다.
        """
        # 잠금 순서는 사용자 → 정성 기간이다. 지연된 오류 저장과 삭제를 직렬화한다.
        locked_user = await self.repo.get_for_update(user.id)
        if locked_user is None or locked_user.deleted_at is not None:
            return
        user = locked_user
        for purger in purgers:
            await purger.delete_for_user(user.id)
        user.deleted_at = utcnow()
        user.email = f"deleted:{user.id}"
        # 로그인 수단도 같은 트랜잭션에서 지운다 — 같은 구글 계정으로 다시 가입할 수 있어야 한다.
        await self.identities.delete_for_user(user.id)
        user.password_hash = None
        await self.repo.save(user)  # 한 번의 커밋 — purger 의 DELETE 도 같은 세션에서 함께 반영된다

    async def remove_identity(self, user: User, identity_id: uuid.UUID, token_version: int) -> int:
        """로그인 수단 해제. 사용자 행을 잠근 뒤 남는 수단이 있는지 판정해 동시 해제로 계정이 잠기지 않게 한다.

        잠금 직후 DB 의 session_version 이 요청 토큰의 sv 와 다르면(인증 뒤 다른 요청이 버전을 올림) 변경 없이
        401 로 거절한다. 같은 트랜잭션에서 session_version 을 올려 다른 기기·옛 토큰을 끊고, 이번 요청이 기록한
        새 버전을 돌려준다 — 호출자는 커밋 뒤 다시 읽은 값이 아니라 이 값으로 쿠키를 발급한다.
        """
        locked = await self.repo.get_for_update(user.id)
        if locked is None or locked.deleted_at is not None:
            raise IdentityError(status.HTTP_404_NOT_FOUND, "IDENTITY_NOT_FOUND", "로그인 수단을 찾을 수 없어요")
        if locked.session_version != token_version:
            await self.repo.session.rollback()  # 잠금을 푼다 — 변경 없음
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다")
        identity = await self.identities.get_for_user(locked.id, identity_id)
        if identity is None:
            await self.repo.session.rollback()  # 잠금을 푼다
            raise IdentityError(status.HTTP_404_NOT_FOUND, "IDENTITY_NOT_FOUND", "로그인 수단을 찾을 수 없어요")
        remaining = await self.identities.count_for_user(locked.id) + (1 if locked.password_hash else 0)
        if remaining <= 1:
            await self.repo.session.rollback()
            raise IdentityError(
                status.HTTP_409_CONFLICT, "LAST_LOGIN_METHOD", "마지막 로그인 수단은 해제할 수 없어요"
            )
        new_version = token_version + 1  # 잠금 시점 값 + 1 (위에서 같음을 확인했다)
        locked.session_version = new_version
        await self.identities.delete_and_commit(identity)
        return new_version

    async def login_methods(self, user: User) -> list[LoginMethod]:
        methods: list[LoginMethod] = []
        if user.password_hash:
            methods.append(LoginMethod(provider="password", identity_id=None, email=user.email, linked_at=None))
        for identity in await self.identities.list_for_user(user.id):
            methods.append(
                LoginMethod(
                    provider=identity.provider,
                    identity_id=identity.id,
                    email=identity.email,
                    linked_at=identity.created_at,
                )
            )
        return methods

    @staticmethod
    def issue_token(user: User) -> str:
        """JWT aud="hoondok". admin 디코더는 aud 가 있는 토큰을 거부하므로 admin API 에 쓸 수 없다.

        sv 는 users.session_version 이다. 로그인 수단이 바뀌면(연결·해제) DB 값이 올라가 옛 토큰이 무효가 된다.
        """
        return IdentityService.issue_session_token(user.id, user.session_version)

    @staticmethod
    def issue_session_token(user_id: uuid.UUID, session_version: int) -> str:
        """수단 변경 요청이 직접 기록한 sv 로 토큰을 만든다(커밋 뒤 다시 읽은 값은 다른 요청의 것일 수 있다)."""
        return create_access_token(
            {"sub": str(user_id), "aud": AUDIENCE, "sv": session_version},
            expires_minutes=settings.hoondok_jwt_expire_minutes,
        )

    @staticmethod
    def to_public(user: User, login_methods: Sequence[LoginMethod] = ()) -> UserPublic:
        return UserPublic(
            id=user.id, email=user.email, display_name=user.display_name, login_methods=list(login_methods)
        )

    async def public_user(self, user: User) -> UserPublic:
        return self.to_public(user, await self.login_methods(user))
