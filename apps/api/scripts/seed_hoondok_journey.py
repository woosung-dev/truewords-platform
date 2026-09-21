"""격리 E2E 전용 합성 코퍼스·권리 원장. 운영 원문을 복사하지 않는다."""

import asyncio
from pathlib import Path
import sys
from urllib.parse import urlparse
from uuid import NAMESPACE_URL, uuid5

import httpx
from sqlmodel import select

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.common.database import async_session_factory, init_db
from app.core.config import settings
from app.modules.hoondok.models import ContentRight

FIXTURE_VOLUME = "말씀선집 355권"
FIXTURE_TEXT = (
    "감사와 참사랑은 이웃의 이야기를 끝까지 듣고 작은 약속을 지키는 일에서 시작합니다. "
    "오늘 만나는 가족에게 따뜻한 말을 전하며 서로를 존중하는 마음을 일상에서 실천합니다."
)
WORKS = [
    (FIXTURE_VOLUME, "allowed", True, True, True, 25),
    ("말씀선집 001권", "allowed", True, True, False, 1),
    ("검색전용 말씀", "allowed", True, False, False, 2),
    ("미승인 말씀", "pending", True, True, True, 2),
    ("철회 말씀", "withdrawn", True, True, True, 2),
]


def chunk_id(volume: str, index: int) -> str:
    return str(uuid5(NAMESPACE_URL, f"hoondok-e2e:{volume}:{index}"))


async def seed() -> None:
    database_url = urlparse(settings.database_url.get_secret_value())
    if (
        settings.environment != "development"
        or database_url.hostname not in {"localhost", "127.0.0.1"}
        or database_url.port != 15432
        or database_url.path != "/truewords_e2e"
        or settings.qdrant_url != "http://127.0.0.1:16333"
    ):
        raise SystemExit("격리 truewords_e2e DB·Qdrant에서만 실행할 수 있습니다")
    await init_db()
    async with async_session_factory() as session:
        for volume, status, search, full_text, jeongseong, _ in WORKS:
            result = await session.execute(select(ContentRight).where(ContentRight.volume == volume))
            right = result.scalar_one_or_none()
            if right is None:
                right = ContentRight(volume=volume)
            right.work_title = volume
            right.status = status
            right.scope_search = search
            right.scope_full_text = full_text
            right.scope_jeongseong = jeongseong
            right.source_keys = ["O"]
            right.book_series = "E2E 합성 말씀"
            right.note = "E2E 합성 코퍼스 전용 권리 fixture"
            session.add(right)
        await session.commit()
    async with httpx.AsyncClient(base_url=settings.qdrant_url, timeout=30) as client:
        collection_path = f"/collections/{settings.collection_name}"
        response = await client.get(collection_path)
        if response.status_code == 404:
            response = await client.put(
                collection_path,
                json={
                    "vectors": {"dense": {"size": 4, "distance": "Cosine"}},
                    "sparse_vectors": {"sparse": {}},
                },
            )
        response.raise_for_status()
        points = []
        for volume, _, _, _, _, count in WORKS:
            for index in range(count):
                points.append(
                    {
                        "id": chunk_id(volume, index),
                        "vector": {"dense": [1.0, 0.0, 0.0, 0.0], "sparse": {"indices": [1], "values": [1.0]}},
                        "payload": {
                            "volume": volume,
                            "chunk_index": index,
                            "text": f"{FIXTURE_TEXT} 이것은 여정 검증을 위한 {index + 1}번째 합성 문장입니다.",
                            "source": ["O"],
                            "book_series": "E2E 합성 말씀",
                        },
                    }
                )
        response = await client.put(f"{collection_path}/points", params={"wait": "true"}, json={"points": points})
        response.raise_for_status()
    print(f"훈독 여정 fixture: {len(WORKS)}개 저작물 · {len(points)}청크")


if __name__ == "__main__":
    asyncio.run(seed())
