"""분석 대시보드 SQL 집계 쿼리."""

from datetime import datetime, timedelta

from uuid import UUID

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

    async def get_query_details(
        self,
        query_text: str,
        days: int = 30,
        limit: int = 50,
    ) -> dict:
        """특정 질문의 모든 발생 상세 조회.

        반환 구조:
            {
                "query_text": str,
                "total_count": int,       # 기간 내 전체 발생 수
                "returned_count": int,    # 응답에 담긴 수 (<= limit)
                "days": int,
                "occurrences": list[dict] # asked_at desc
            }
        """
        cutoff = datetime.utcnow() - timedelta(days=days)

        # 1) 전체 발생 수 (limit 초과 감지용)
        # 주: search_events.message_id 는 assistant 메시지를 가리킨다.
        count_result = await self.session.execute(
            text("""
                SELECT COUNT(*) AS total
                FROM search_events
                WHERE query_text = :q
                  AND created_at >= :cutoff
            """),
            {"q": query_text, "cutoff": cutoff},
        )
        total_count = count_result.scalar_one() or 0

        if total_count == 0:
            return {
                "query_text": query_text,
                "total_count": 0,
                "returned_count": 0,
                "days": days,
                "occurrences": [],
            }

        # 2) 발생 목록 + 답변(assistant) + 봇명 조회
        occ_result = await self.session.execute(
            text("""
                SELECT
                    se.id AS search_event_id,
                    se.message_id AS assistant_message_id,
                    se.rewritten_query,
                    se.search_tier,
                    se.total_results,
                    se.latency_ms,
                    se.applied_filters,
                    sm.session_id,
                    sm.content AS answer_text,
                    sm.created_at AS answered_at,
                    rs.chatbot_config_id AS chatbot_id,
                    cc.display_name AS chatbot_name
                FROM search_events se
                JOIN session_messages sm ON sm.id = se.message_id
                JOIN research_sessions rs ON rs.id = sm.session_id
                LEFT JOIN chatbot_configs cc ON cc.id = rs.chatbot_config_id
                WHERE se.query_text = :q
                  AND sm.role = 'ASSISTANT'
                  AND se.created_at >= :cutoff
                ORDER BY sm.created_at DESC
                LIMIT :limit
            """),
            {"q": query_text, "cutoff": cutoff, "limit": limit},
        )
        occ_rows = occ_result.all()

        if not occ_rows:
            return {
                "query_text": query_text,
                "total_count": total_count,
                "returned_count": 0,
                "days": days,
                "occurrences": [],
            }

        assistant_ids = [row.assistant_message_id for row in occ_rows]

        # 3) 각 assistant 메시지의 직전 user 메시지 (질문 시점/텍스트 추적용)
        user_msg_result = await self.session.execute(
            text("""
                SELECT
                    assistant_sm.id AS assistant_message_id,
                    user_sm.id AS user_message_id,
                    user_sm.created_at AS asked_at
                FROM session_messages assistant_sm
                JOIN LATERAL (
                    SELECT id, created_at
                    FROM session_messages
                    WHERE session_id = assistant_sm.session_id
                      AND role = 'USER'
                      AND created_at < assistant_sm.created_at
                    ORDER BY created_at DESC
                    LIMIT 1
                ) user_sm ON TRUE
                WHERE assistant_sm.id = ANY(:ids)
            """),
            {"ids": assistant_ids},
        )
        user_msg_map: dict[UUID, dict] = {}
        for row in user_msg_result.all():
            user_msg_map[row.assistant_message_id] = {
                "user_message_id": row.user_message_id,
                "asked_at": row.asked_at,
            }

        # 4) 출처 조회 — assistant 메시지 기준
        citations_map: dict[UUID, list[dict]] = {aid: [] for aid in assistant_ids}
        cite_result = await self.session.execute(
            text("""
                SELECT
                    message_id,
                    source,
                    volume,
                    chapter,
                    text_snippet,
                    relevance_score,
                    rank_position
                FROM answer_citations
                WHERE message_id = ANY(:ids)
                ORDER BY rank_position ASC
            """),
            {"ids": assistant_ids},
        )
        for row in cite_result.all():
            citations_map.setdefault(row.message_id, []).append({
                "source": row.source,
                "volume": row.volume,
                "chapter": row.chapter,
                "text_snippet": row.text_snippet,
                "relevance_score": float(row.relevance_score),
                "rank_position": row.rank_position,
            })

        # 5) 피드백 조회 — assistant 메시지 기준 최신 1건
        feedback_map: dict[UUID, dict] = {}
        fb_result = await self.session.execute(
            text("""
                SELECT DISTINCT ON (message_id)
                    message_id,
                    feedback_type,
                    comment,
                    created_at
                FROM answer_feedback
                WHERE message_id = ANY(:ids)
                ORDER BY message_id, created_at DESC
            """),
            {"ids": assistant_ids},
        )
        for row in fb_result.all():
            feedback_map[row.message_id] = {
                "feedback_type": row.feedback_type,
                "comment": row.comment,
                "created_at": row.created_at,
            }

        # 6) 조합
        occurrences: list[dict] = []
        for row in occ_rows:
            aid = row.assistant_message_id
            user_info = user_msg_map.get(aid)
            # user 메시지가 없는 이례적 케이스는 assistant 시점으로 폴백
            asked_at = user_info["asked_at"] if user_info else row.answered_at
            user_message_id = user_info["user_message_id"] if user_info else None
            occurrences.append({
                "search_event_id": row.search_event_id,
                "user_message_id": user_message_id,
                "assistant_message_id": aid,
                "session_id": row.session_id,
                "chatbot_id": row.chatbot_id,
                "chatbot_name": row.chatbot_name,
                "asked_at": asked_at,
                "rewritten_query": row.rewritten_query,
                "search_tier": row.search_tier,
                "total_results": row.total_results,
                "latency_ms": row.latency_ms,
                "applied_filters": row.applied_filters or {},
                "answer_text": row.answer_text,
                "citations": citations_map.get(aid, []),
                "feedback": feedback_map.get(aid),
            })

        return {
            "query_text": query_text,
            "total_count": total_count,
            "returned_count": len(occurrences),
            "days": days,
            "occurrences": occurrences,
        }

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

    async def get_queries(
        self,
        q: str = "",
        days: int = 30,
        sort: str = "count_desc",
        page: int = 1,
        size: int = 50,
    ) -> dict:
        """고유 질문 집계 + 검색/정렬/페이지네이션.

        반환 구조:
            {
                "items": list[dict],  # query_text, count, latest_at, negative_feedback_count
                "total": int,
                "page": int,
                "size": int,
                "days": int,
            }
        """
        cutoff = datetime.utcnow() - timedelta(days=days)
        q_pattern = f"%{q}%" if q else ""
        offset = (page - 1) * size

        # 1) 총 고유 질문 수
        total_result = await self.session.execute(
            text("""
                SELECT COUNT(DISTINCT query_text) AS total
                FROM search_events
                WHERE created_at >= :cutoff
                  AND (:q = '' OR query_text ILIKE :q_pattern)
            """),
            {"cutoff": cutoff, "q": q, "q_pattern": q_pattern},
        )
        total = total_result.scalar_one() or 0

        if total == 0:
            return {
                "items": [],
                "total": 0,
                "page": page,
                "size": size,
                "days": days,
            }

        # 2) 페이지 항목 + 부정 피드백 집계
        items_result = await self.session.execute(
            text("""
                WITH agg AS (
                    SELECT
                        se.query_text,
                        COUNT(*)::int AS count,
                        MAX(se.created_at) AS latest_at,
                        ARRAY_AGG(DISTINCT se.message_id) AS assistant_ids
                    FROM search_events se
                    WHERE se.created_at >= :cutoff
                      AND (:q = '' OR se.query_text ILIKE :q_pattern)
                    GROUP BY se.query_text
                )
                SELECT
                    agg.query_text,
                    agg.count,
                    agg.latest_at,
                    COALESCE(
                        (SELECT COUNT(*) FROM answer_feedback af
                         WHERE af.message_id = ANY(agg.assistant_ids)
                           AND af.feedback_type != 'HELPFUL'),
                        0
                    )::int AS negative_feedback_count
                FROM agg
                ORDER BY
                    CASE WHEN :sort = 'count_desc'  THEN agg.count END DESC,
                    CASE WHEN :sort = 'count_asc'   THEN agg.count END ASC,
                    CASE WHEN :sort = 'recent_desc' THEN agg.latest_at END DESC,
                    CASE WHEN :sort = 'recent_asc'  THEN agg.latest_at END ASC,
                    agg.query_text ASC
                LIMIT :limit OFFSET :offset
            """),
            {
                "cutoff": cutoff,
                "q": q,
                "q_pattern": q_pattern,
                "sort": sort,
                "limit": size,
                "offset": offset,
            },
        )

        items = [
            {
                "query_text": row.query_text,
                "count": row.count,
                "latest_at": row.latest_at,
                "negative_feedback_count": row.negative_feedback_count,
            }
            for row in items_result.all()
        ]

        return {
            "items": items,
            "total": total,
            "page": page,
            "size": size,
            "days": days,
        }
