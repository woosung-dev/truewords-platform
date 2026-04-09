"""기존 Qdrant payload의 source 필드를 문자열 → 배열로 변환.

임베딩 재생성 불필요. payload만 업데이트.
사용법: cd backend && uv run python scripts/migrate_source_to_array.py
"""

import asyncio
import logging

from qdrant_client import AsyncQdrantClient
from src.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def migrate():
    api_key = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None
    client = AsyncQdrantClient(url=settings.qdrant_url, api_key=api_key)
    collection = settings.collection_name

    migrated = 0
    skipped = 0
    offset = None

    while True:
        points, offset = await client.scroll(
            collection_name=collection,
            with_payload=["source"],
            with_vectors=False,
            limit=500,
            offset=offset,
        )

        if not points:
            break

        for p in points:
            src = p.payload.get("source")
            if isinstance(src, str):
                await client.set_payload(
                    collection_name=collection,
                    payload={"source": [src]},
                    points=[p.id],
                )
                migrated += 1
            elif isinstance(src, list):
                skipped += 1
            else:
                logger.warning("포인트 %s: source 필드가 예상과 다름: %s", p.id, src)
                skipped += 1

        logger.info("진행 중... migrated=%d, skipped=%d", migrated, skipped)

        if offset is None:
            break

    logger.info("마이그레이션 완료: %d개 변환, %d개 스킵 (이미 배열)", migrated, skipped)
    await client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
