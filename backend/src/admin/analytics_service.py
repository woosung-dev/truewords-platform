# 분석 대시보드 service — AsyncSession 격리, repository 호출 + qdrant count 합본.
"""AnalyticsService — P0-6 audit fix.

기존 `analytics_router._get_repo` 가 router 내부에서 Repository 를 직접 조립하던
패턴을 service 레이어로 이관. dashboard 요약은 RDB 카운트 + Qdrant points count
조합이라 service 단에서 정합 처리한다. 나머지는 repo 의 read-only pass-through.

룰 §3 "Router HTTP 수신만, Service AsyncSession import 금지, Dependencies 조립의
유일한 위치" 정합.
"""

from __future__ import annotations

import logging
from uuid import UUID

from src.admin.analytics_repository import AnalyticsRepository
from src.config import settings
from src.qdrant_client import get_raw_client

logger = logging.getLogger(__name__)


class AnalyticsService:
    def __init__(self, repo: AnalyticsRepository) -> None:
        self.repo = repo

    async def get_dashboard_summary(self) -> dict:
        """대시보드 홈 요약 — RDB 카운트 + Qdrant points count 합본."""
        questions = await self.repo.get_question_counts()
        feedback = await self.repo.get_feedback_counts()
        try:
            qdrant_count = await get_raw_client().count(settings.collection_name)
        except Exception as exc:
            logger.warning("dashboard qdrant count 실패 (0 으로 노출): %r", exc)
            qdrant_count = 0
        return {
            "today_questions": questions["today"],
            "week_questions": questions["week"],
            "total_qdrant_points": qdrant_count,
            "feedback_helpful": feedback["helpful"],
            "feedback_negative": feedback["negative"],
        }

    async def get_daily_trend(self, days: int) -> list[dict]:
        return await self.repo.get_daily_trend(days)

    async def get_daily_modes(self, days: int) -> list[dict]:
        return await self.repo.get_daily_modes(days)

    async def get_search_stats(self, days: int) -> dict:
        return await self.repo.get_search_stats(days)

    async def get_top_queries(self, days: int, limit: int) -> list[dict]:
        return await self.repo.get_top_queries(days, limit)

    async def get_feedback_distribution(self, days: int) -> list[dict]:
        return await self.repo.get_feedback_distribution(days)

    async def get_feedback_list(
        self, polarity: str, limit: int, offset: int
    ) -> list[dict]:
        return await self.repo.get_feedback_list(polarity, limit, offset)

    async def get_query_details(
        self, query_text: str, days: int, limit: int
    ) -> dict:
        return await self.repo.get_query_details(query_text, days, limit)

    async def get_session_detail(self, session_id: UUID) -> dict | None:
        return await self.repo.get_session_detail(session_id)

    async def get_queries(
        self,
        *,
        q: str,
        days: int,
        sort: str,
        page: int,
        size: int,
    ) -> dict:
        return await self.repo.get_queries(
            q=q, days=days, sort=sort, page=page, size=size
        )
