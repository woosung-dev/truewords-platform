"""훈독 identity Service — 가입·로그인·토큰 발급."""

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.modules.admin.auth import create_access_token, hash_password, verify_password
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository
from app.modules.identity.schemas import LoginRequest, SignupRequest, UserPublic

AUDIENCE = "hoondok"
# 이메일 존재 여부를 구분하지 않는다 (API-HD-003).
_INVALID_CREDENTIALS = "이메일 또는 비밀번호가 올바르지 않습니다"


class IdentityService:
    def __init__(self, repo: UserRepository) -> None:
        self.repo = repo

    async def signup(self, data: SignupRequest) -> User:
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
