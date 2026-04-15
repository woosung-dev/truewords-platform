"""분석 대시보드 SQL 집계 쿼리."""

from datetime import datetime, timedelta

from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession


class AnalyticsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_question_counts(self) -> dict:
        """오늘/이번주 질문 수 조회."""
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=today_start.weekday())

        result = await self.session.execute(
            text("""
                SELECT
                    COUNT(*) FILTER (WHERE created_at >= :today) AS today_count,
                    COUNT(*) FILTER (WHERE created_at >= :week) AS week_count
                FROM search_events
            """),
            {"today": today_start, "week": week_start},
        )
        row = result.one()
        return {"today": row.today_count, "week": row.week_count}

    async def get_feedback_counts(self) -> dict:
        """피드백 긍정/부정 수 조회."""
        result = await self.session.execute(
            text("""
                SELECT
                    COUNT(*) FILTER (WHERE feedback_type = 'HELPFUL') AS helpful,
                    COUNT(*) FILTER (WHERE feedback_type != 'HELPFUL') AS negative
                FROM answer_feedback
            """)
        )
        row = result.one()
        return {"helpful": row.helpful, "negative": row.negative}

    async def get_daily_trend(self, days: int = 30) -> list[dict]:
        """일별 질문 수 트렌드."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await self.session.execute(
            text("""
                SELECT DATE(created_at) AS date, COUNT(*) AS count
                FROM search_events
                WHERE created_at >= :cutoff
                GROUP BY DATE(created_at)
                ORDER BY date
            """),
            {"cutoff": cutoff},
        )
        return [{"date": str(row.date), "count": row.count} for row in result.all()]

    async def get_search_stats(self, days: int = 30) -> dict:
        """검색 통계 집계."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await self.session.execute(
            text("""
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE rewritten_query IS NOT NULL) AS rewritten,
                    COUNT(*) FILTER (WHERE total_results = 0) AS zero_results,
                    COALESCE(AVG(latency_ms), 0) AS avg_latency,
                    COUNT(*) FILTER (WHERE applied_filters->>'fallback_type' = 'none'
                                     OR applied_filters->>'fallback_type' IS NULL) AS fb_none,
                    COUNT(*) FILTER (WHERE applied_filters->>'fallback_type' = 'relaxed') AS fb_relaxed,
                    COUNT(*) FILTER (WHERE applied_filters->>'fallback_type' = 'suggestions') AS fb_suggestions
                FROM search_events
                WHERE created_at >= :cutoff
            """),
            {"cutoff": cutoff},
        )
        row = result.one()
        total = row.total or 1  # 0으로 나누기 방지
        return {
            "total_searches": row.total,
            "rewrite_rate": round(row.rewritten / total, 3),
            "zero_result_rate": round(row.zero_results / total, 3),
            "avg_latency_ms": round(float(row.avg_latency), 1),
            "fallback_none": row.fb_none,
            "fallback_relaxed": row.fb_relaxed,
            "fallback_suggestions": row.fb_suggestions,
        }

    async def get_top_queries(self, days: int = 30, limit: int = 10) -> list[dict]:
        """인기 질문 Top N."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await self.session.execute(
            text("""
                SELECT query_text, COUNT(*) AS count
                FROM search_events
                WHERE created_at >= :cutoff
                GROUP BY query_text
                ORDER BY count DESC
                LIMIT :limit
            """),
            {"cutoff": cutoff, "limit": limit},
        )
        return [{"query_text": row.query_text, "count": row.count} for row in result.all()]

    async def get_feedback_distribution(self, days: int = 30) -> list[dict]:
        """피드백 유형 분포."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await self.session.execute(
            text("""
                SELECT feedback_type, COUNT(*) AS count
                FROM answer_feedback
                WHERE created_at >= :cutoff
                GROUP BY feedback_type
                ORDER BY count DESC
            """),
            {"cutoff": cutoff},
        )
        return [{"feedback_type": row.feedback_type, "count": row.count} for row in result.all()]

    async def get_negative_feedback(self, limit: int = 20, offset: int = 0) -> list[dict]:
        """부정 피드백 목록 (질문 + 답변 포함)."""
        result = await self.session.execute(
            text("""
                SELECT
                    af.id,
                    af.feedback_type,
                    af.comment,
                    af.created_at,
                    sm_answer.content AS answer,
                    (
                        SELECT sm_q.content
                        FROM session_messages sm_q
                        WHERE sm_q.session_id = sm_answer.session_id
                          AND sm_q.role = 'USER'
                          AND sm_q.created_at < sm_answer.created_at
                        ORDER BY sm_q.created_at DESC
                        LIMIT 1
                    ) AS question
                FROM answer_feedback af
                JOIN session_messages sm_answer ON sm_answer.id = af.message_id
                WHERE af.feedback_type != 'HELPFUL'
                ORDER BY af.created_at DESC
                LIMIT :limit OFFSET :offset
            """),
            {"limit": limit, "offset": offset},
        )
        return [
            {
                "id": row.id,
                "question": row.question or "",
                "answer_snippet": (row.answer or "")[:200],
                "feedback_type": row.feedback_type,
                "comment": row.comment,
                "created_at": row.created_at,
            }
            for row in result.all()
        ]
