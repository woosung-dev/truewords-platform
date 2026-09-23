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
from app.modules.hoondok.models import ContentRight, VolumeSection

FIXTURE_VOLUME = "말씀선집 355권"
FIXTURE_TEXT = (
    "감사와 참사랑은 이웃의 이야기를 끝까지 듣고 작은 약속을 지키는 일에서 시작합니다. "
    "오늘 만나는 가족에게 따뜻한 말을 전하며 서로를 존중하는 마음을 일상에서 실천합니다."
)
# (volume, status, scope_search, scope_full_text, scope_jeongseong, 청크 수, book_series)
# 앞 두 권만 저작물(`father_anthology`)로 묶여 서고 → 권 목록 → 원문 3계층을 검증한다.
WORKS = [
    (FIXTURE_VOLUME, "allowed", True, True, True, 25, "father_anthology"),
    ("말씀선집 001권", "allowed", True, True, False, 1, "father_anthology"),
    ("검색전용 말씀", "allowed", True, False, False, 2, "E2E 합성 말씀"),
    ("미승인 말씀", "pending", True, True, True, 2, "E2E 합성 말씀"),
    ("철회 말씀", "withdrawn", True, True, True, 2, "E2E 합성 말씀"),
]

# ENT-HD-010 장 목차 fixture — 편(level 1) 2 + 장(level 2) 1. 추출 스크립트와 같은 `origin='auto'` 다.
# position 3 은 두 번째 페이지(chunk 20~24)로 들어가 "장을 눌러 페이지 이동" 을 검증한다.
FIXTURE_SECTIONS = [
    (1, 1, "제1편 감사의 길", 0, 19, None, None),
    (2, 2, "1장 이웃을 듣는 마음", 0, 19, "1956년 4월 8일", "전 본부교회"),
    (3, 1, "제2편 참사랑의 실천", 20, 24, None, None),
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
        for volume, status, search, full_text, jeongseong, count, series in WORKS:
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
            right.book_series = series
            right.chunk_count = count
            right.note = "E2E 합성 코퍼스 전용 권리 fixture"
            session.add(right)
        existing = await session.execute(
            select(VolumeSection).where(VolumeSection.volume == FIXTURE_VOLUME)
        )
        rows = {row.position: row for row in existing.scalars()}
        for position, level, title, start, end, spoken_on, place in FIXTURE_SECTIONS:
            section = rows.get(position) or VolumeSection(volume=FIXTURE_VOLUME, position=position)
            section.level = level
            section.title = title
            section.start_chunk_index = start
            section.end_chunk_index = end
            section.spoken_on = spoken_on
            section.place = place
            section.origin = "auto"
            session.add(section)
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
        for volume, _, _, _, _, count, series in WORKS:
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
                            "book_series": series,
                        },
                    }
                )
        response = await client.put(f"{collection_path}/points", params={"wait": "true"}, json={"points": points})
        response.raise_for_status()
    print(
        f"훈독 여정 fixture: {len(WORKS)}개 저작물 · {len(points)}청크 · 장 {len(FIXTURE_SECTIONS)}개"
    )


if __name__ == "__main__":
    asyncio.run(seed())
