"""관리자 Repository. AsyncSession 유일 보유자."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.admin.models import AdminAuditLog, AdminUser


class AdminRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_user_by_email(self, email: str) -> AdminUser | None:
        result = await self.session.execute(
            select(AdminUser).where(AdminUser.email == email)
        )
        return result.scalar_one_or_none()

    async def get_user_by_id(self, user_id: uuid.UUID) -> AdminUser | None:
        result = await self.session.execute(
            select(AdminUser).where(AdminUser.id == user_id)
        )
        return result.scalar_one_or_none()

    async def create_user(self, user: AdminUser) -> AdminUser:
        self.session.add(user)
        await self.session.flush()
        return user

    async def create_audit_log(self, log: AdminAuditLog) -> AdminAuditLog:
        self.session.add(log)
        await self.session.flush()
        return log

    async def get_audit_logs(
        self, limit: int = 50, offset: int = 0
    ) -> list[AdminAuditLog]:
        result = await self.session.execute(
            select(AdminAuditLog)
            .order_by(AdminAuditLog.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    async def commit(self) -> None:
        await self.session.commit()
