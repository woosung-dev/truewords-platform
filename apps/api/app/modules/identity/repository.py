"""훈독 identity Repository — AsyncSession 은 여기만 보유한다."""

import uuid

from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.identity.models import User, UserIdentity


def normalize_email(email: str) -> str:
    return email.strip().lower()


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(select(User).where(User.email == normalize_email(email)))
        return result.scalar_one_or_none()

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_for_update(self, user_id: uuid.UUID) -> User | None:
        """계정 삭제와 사용자 연결 오류 저장이 공유하는 행 잠금."""
        result = await self.session.execute(
            select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def create(self, user: User) -> User:
        user.email = normalize_email(user.email)
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def save(self, user: User) -> User:
        """변경 저장 + 커밋. 계정 삭제(API-HD-011)에서는 같은 세션에 쌓인 훈독 데이터 삭제도 이 커밋으로 함께 반영된다."""
        self.session.add(user)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(user)
        return user


class UserIdentityRepository:
    """로그인 수단(user_identities) 저장소. UserRepository 와 같은 세션을 공유해 한 트랜잭션으로 묶인다."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_subject(self, issuer: str, subject_scope: str, subject: str) -> UserIdentity | None:
        result = await self.session.execute(
            select(UserIdentity).where(
                UserIdentity.issuer == issuer,
                UserIdentity.subject_scope == subject_scope,
                UserIdentity.subject == subject,
            )
        )
        return result.scalar_one_or_none()

    async def get_for_user(self, user_id: uuid.UUID, identity_id: uuid.UUID) -> UserIdentity | None:
        """남의 identity 는 없는 것과 같다(소유 검사를 쿼리에 넣는다)."""
        result = await self.session.execute(
            select(UserIdentity).where(UserIdentity.id == identity_id, UserIdentity.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_by_user_issuer(self, user_id: uuid.UUID, issuer: str, subject_scope: str) -> UserIdentity | None:
        result = await self.session.execute(
            select(UserIdentity).where(
                UserIdentity.user_id == user_id,
                UserIdentity.issuer == issuer,
                UserIdentity.subject_scope == subject_scope,
            )
        )
        return result.scalar_one_or_none()

    async def list_for_user(self, user_id: uuid.UUID) -> list[UserIdentity]:
        result = await self.session.execute(
            select(UserIdentity).where(UserIdentity.user_id == user_id).order_by(UserIdentity.created_at)
        )
        return list(result.scalars().all())

    async def count_for_user(self, user_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == user_id)
        )
        return int(result.scalar_one())

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """커밋하지 않는다 — 계정 삭제 트랜잭션(UserRepository.save 의 커밋)에 묶인다."""
        await self.session.execute(delete(UserIdentity).where(UserIdentity.user_id == user_id))

    async def delete_and_commit(self, identity: UserIdentity) -> None:
        try:
            await self.session.delete(identity)
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

    async def save(self, identity: UserIdentity) -> UserIdentity:
        self.session.add(identity)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(identity)
        return identity

    async def create_user_with_identity(self, user: User, identity: UserIdentity) -> User:
        """사용자와 로그인 수단을 한 트랜잭션으로 만든다. unique 충돌(IntegrityError)은 롤백 후 호출자에게 올린다."""
        user.email = normalize_email(user.email)
        identity.user_id = user.id
        self.session.add(user)
        self.session.add(identity)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(user)
        return user

    async def link_to_user(self, user: User, identity: UserIdentity) -> UserIdentity:
        """기존 사용자에 로그인 수단을 붙이고 사용자 변경(비밀번호 해시 제거·이메일 확인 기록)과 함께 커밋한다."""
        identity.user_id = user.id
        self.session.add(user)
        self.session.add(identity)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(identity)
        return identity
