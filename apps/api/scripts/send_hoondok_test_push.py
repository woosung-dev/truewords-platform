"""매분 테스트 예약 처리. 실행 결과에는 건수만 출력한다."""

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.core.common.database import async_session_factory
from app.modules.hoondok.push_test_service import run
from app.modules.hoondok.push_test_repository import PushTestRepository


async def main():
    async with async_session_factory() as session:
        count = await run(PushTestRepository(session))
    print(json.dumps({"processed": count}))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
