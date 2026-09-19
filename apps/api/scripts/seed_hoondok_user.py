"""훈독 일반 사용자 시드 — 로컬·E2E 전용 (PLAN-HD-001 Phase 2 sub-PR D).

사용: uv run python scripts/seed_hoondok_user.py <email> <password> [--name 이름]
이미 있는 이메일은 건너뛴다(멱등). 운영 환경에서는 실행하지 않는다.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.common.database import async_session_factory, init_db
from app.core.config import settings
from app.modules.admin.auth import hash_password
from app.modules.identity.models import User
from app.modules.identity.repository import UserRepository


async def seed(email: str, password: str, display_name: str) -> None:
    if settings.environment == "production":
        raise SystemExit("운영 환경에서는 시드를 실행하지 않는다 (PLAN-HD-001 결정 6)")
    await init_db()
    async with async_session_factory() as session:
        repo = UserRepository(session)
        if await repo.get_by_email(email):
            print(f"이미 존재하는 훈독 사용자: {email}")
            return
        await repo.create(User(email=email, password_hash=hash_password(password), display_name=display_name))
        print(f"훈독 사용자 생성 완료: {email}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("email")
    parser.add_argument("password")
    parser.add_argument("--name", default="시드 식구")
    args = parser.parse_args()
    asyncio.run(seed(args.email, args.password, args.name))
