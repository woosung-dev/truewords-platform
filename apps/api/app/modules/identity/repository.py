"""훈독 identity Repository — AsyncSession 은 여기만 보유한다."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.identity.models import User


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
