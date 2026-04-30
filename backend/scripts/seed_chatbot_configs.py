"""기존 configs.py 하드코딩 데이터를 PostgreSQL에 삽입하는 seed 스크립트.

Phase 2.4 이후 메인 컬렉션 토글이 폐기되어, 모든 봇은 settings.collection_name
(env COLLECTION_NAME) 단일 컬렉션을 공유한다. PoC 청킹 봇(chunking-*, all-paragraph)
은 더 이상 별도 컬렉션을 가리키지 않으며 'all' 봇과 동작이 동일해진다.
다음 배포에서 collection_main 컬럼이 drop되며, PoC 봇은 시드에서도 정리될 예정.
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
    # 청킹 PoC 봇 (Phase 2.x) — collection_main 폐기로 'all' 봇과 동일 동작.
    # 다음 배포에서 시드에서도 제거 예정.
    ChatbotConfig(
        chatbot_id="chunking-sentence",
        display_name="청킹 PoC: 문장",
        description="[DEPRECATED] Phase 2.4 이후 'all' 봇과 동일 동작",
        search_tiers={
            "tiers": [
                {"sources": ["A", "B", "C"], "min_results": 3, "score_threshold": 0.60},
            ]
        },
    ),
    ChatbotConfig(
        chatbot_id="chunking-token1024",
        display_name="청킹 PoC: 토큰",
        description="[DEPRECATED] Phase 2.4 이후 'all' 봇과 동일 동작",
        search_tiers={
            "tiers": [
                {"sources": ["A", "B", "C"], "min_results": 3, "score_threshold": 0.60},
            ]
        },
    ),
    ChatbotConfig(
        chatbot_id="chunking-paragraph",
        display_name="청킹 PoC: 단락",
        description="[DEPRECATED] Phase 2.4 이후 'all' 봇과 동일 동작",
        search_tiers={
            "tiers": [
                {"sources": ["A", "B", "C"], "min_results": 3, "score_threshold": 0.60},
            ]
        },
    ),
    ChatbotConfig(
        chatbot_id="all-paragraph",
        display_name="전체 검색 (paragraph 본 가동 후보)",
        description="[DEPRECATED] Phase 2.4 이후 'all' 봇과 동일 동작",
        search_tiers={
            "tiers": [
                {"sources": ["A", "B", "C"], "min_results": 3, "score_threshold": 0.60},
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
