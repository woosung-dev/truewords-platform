"""기존 configs.py 하드코딩 데이터를 PostgreSQL에 삽입하는 seed 스크립트.

Phase 2.4 (v5 Recursive 88권 단일 운영) 이후 모든 봇은 settings.collection_name
(env COLLECTION_NAME) 단일 컬렉션을 공유한다. Phase 2.x 청킹 PoC 봇
(chunking-*, all-paragraph) 은 Alembic 마이그레이션 aa6f4b908ef4 의 데이터
정리 단계에서 is_active=False 로 비활성화되며, 본 시드에서는 더 이상 만들지
않는다.
"""

import asyncio
import sys
from pathlib import Path

# 프로젝트 루트(backend/)를 sys.path에 추가하여 src 모듈 import 가능하게 함
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.chatbot.models import ChatbotConfig
from src.common.database import async_session_factory, init_db

SEED_DATA = [
    ChatbotConfig(
        chatbot_id="malssum_priority",
        display_name="말씀선집 우선",
        description="말씀선집(A)을 최우선으로 검색하고, 부족 시 B, C로 확장",
        search_tiers={
            "tiers": [
                {"sources": ["A"], "min_results": 3, "score_threshold": 0.75},
                {"sources": ["B"], "min_results": 2, "score_threshold": 0.65},
                {"sources": ["C"], "min_results": 1, "score_threshold": 0.60},
            ]
        },
    ),
    ChatbotConfig(
        chatbot_id="all",
        display_name="전체 검색",
        description="모든 데이터 소스(A, B, C)에서 동시 검색",
        search_tiers={
            "tiers": [
                {"sources": ["A", "B", "C"], "min_results": 3, "score_threshold": 0.60},
            ]
        },
    ),
    ChatbotConfig(
        chatbot_id="source_a_only",
        display_name="소스 A 전용",
        description="소스 A 데이터만 검색",
        search_tiers={
            "tiers": [
                {"sources": ["A"], "min_results": 1, "score_threshold": 0.50},
            ]
        },
    ),
    ChatbotConfig(
        chatbot_id="source_b_only",
        display_name="소스 B 전용",
        description="소스 B 데이터만 검색",
        search_tiers={
            "tiers": [
                {"sources": ["B"], "min_results": 1, "score_threshold": 0.50},
            ]
        },
    ),
]


async def seed():
    await init_db()
    async with async_session_factory() as session:
        for config in SEED_DATA:
            # 중복 방지: chatbot_id로 기존 데이터 확인
            from sqlmodel import select
            result = await session.execute(
                select(ChatbotConfig).where(
                    ChatbotConfig.chatbot_id == config.chatbot_id
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                print(f"  이미 존재: {config.chatbot_id}")
                continue
            session.add(config)
            print(f"  추가: {config.chatbot_id}")
        await session.commit()
    print("Seed 완료")


if __name__ == "__main__":
    asyncio.run(seed())
