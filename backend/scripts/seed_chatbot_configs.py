"""기존 configs.py 하드코딩 데이터를 PostgreSQL에 삽입하는 seed 스크립트."""

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
    # 옵션 F 청킹 PoC — 평화경 1권 재청킹 + 나머지 614권 baseline (vector copy)
    # 검색 동작은 'all' 봇과 동일, collection_main만 PoC 컬렉션으로 라우팅
    ChatbotConfig(
        chatbot_id="chunking-sentence",
        display_name="청킹 PoC: 문장",
        description="옵션 F PoC — 평화경 sentence-based 청킹 (baseline 비교용)",
        search_tiers={
            "tiers": [
                {"sources": ["A", "B", "C"], "min_results": 3, "score_threshold": 0.60},
            ]
        },
        collection_main="malssum_chunking_poc_sentence",
    ),
    ChatbotConfig(
        chatbot_id="chunking-token1024",
        display_name="청킹 PoC: 토큰",
        description="옵션 F PoC — 평화경 char-based 2560/500 sliding window",
        search_tiers={
            "tiers": [
                {"sources": ["A", "B", "C"], "min_results": 3, "score_threshold": 0.60},
            ]
        },
        collection_main="malssum_chunking_poc_token1024",
    ),
    ChatbotConfig(
        chatbot_id="chunking-paragraph",
        display_name="청킹 PoC: 단락",
        description="옵션 F PoC — 평화경 blank-line 단락 + min_chars=200 병합",
        search_tiers={
            "tiers": [
                {"sources": ["A", "B", "C"], "min_results": 3, "score_threshold": 0.60},
            ]
        },
        collection_main="malssum_chunking_poc_paragraph",
    ),
    # 옵션 F 본 가동 A/B (Phase 2.1) — 88권 모두 paragraph 재청킹된 v3 컬렉션
    # 'all' 봇 (v1, malssum_poc 88권 sentence)과 동일 검색 정책, collection_main만 v3
    ChatbotConfig(
        chatbot_id="all-paragraph",
        display_name="전체 검색 (paragraph 본 가동 후보)",
        description="옵션 F 본 가동 A/B — 88권 paragraph 청킹 (malssum_poc_v3, 22,419 청크)",
        search_tiers={
            "tiers": [
                {"sources": ["A", "B", "C"], "min_results": 3, "score_threshold": 0.60},
            ]
        },
        collection_main="malssum_poc_v3",
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
