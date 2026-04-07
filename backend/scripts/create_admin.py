"""초기 관리자 계정 생성 스크립트."""

import asyncio
import sys
from pathlib import Path

# 프로젝트 루트(backend/)를 sys.path에 추가하여 src 모듈 import 가능하게 함
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.admin.auth import hash_password
from src.admin.models import AdminRole, AdminUser
from src.common.database import async_session_factory, init_db


async def create_admin(email: str, password: str):
    await init_db()
    async with async_session_factory() as session:
        from sqlmodel import select
        result = await session.execute(
            select(AdminUser).where(AdminUser.email == email)
        )
        if result.scalar_one_or_none():
            print(f"이미 존재하는 계정: {email}")
            return
        user = AdminUser(
            email=email,
            hashed_password=hash_password(password),
            role=AdminRole.SUPER_ADMIN,
        )
        session.add(user)
        await session.commit()
        print(f"관리자 계정 생성 완료: {email}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("사용법: python scripts/create_admin.py <email> <password>")
        sys.exit(1)
    asyncio.run(create_admin(sys.argv[1], sys.argv[2]))
