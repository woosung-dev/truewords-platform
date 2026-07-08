"""채팅 Repository. 세션, 메시지, 검색 이벤트, 인용, 피드백 DB 접근."""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.chat.models import (
    AnswerCitation,
    AnswerFeedback,
    ResearchSession,
    SearchEvent,
    SessionMessage,
)


class ChatRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- 세션 ---

    async def create_session(self, research_session: ResearchSession) -> ResearchSession:
        self.session.add(research_session)
        await self.session.flush()
        return research_session

    async def get_session(self, session_id: uuid.UUID) -> ResearchSession | None:
        result = await self.session.execute(
            select(ResearchSession).where(ResearchSession.id == session_id)
        )
        return result.scalar_one_or_none()

    async def list_sessions_by_user(
        self, user_id: uuid.UUID, limit: int, offset: int
    ) -> tuple[list[dict], int]:
        """로그인 사용자의 대화 세션 목록 + 총 개수.

        메시지가 1건 이상인 세션만, 마지막 활동 시각 내림차순.
        각 항목 = 첫 사용자 질문(preview) + 메시지 수 + 봇 표시명 + 시각.
        analytics_repository 의 text() SQL 패턴을 따른다 (role 은 native enum 대문자).
        """
        total_result = await self.session.execute(
            text(
                """
                SELECT COUNT(*) FROM (
                    SELECT rs.id
                    FROM research_sessions rs
                    JOIN session_messages sm ON sm.session_id = rs.id
                    WHERE rs.user_id = :uid
                    GROUP BY rs.id
                ) t
                """
            ),
            {"uid": user_id},
        )
        total = total_result.scalar_one() or 0

        result = await self.session.execute(
            text(
                """
                SELECT
                    rs.id AS session_id,
                    rs.started_at,
                    cc.display_name AS chatbot_name,
                    COUNT(sm.id)::int AS message_count,
                    MAX(sm.created_at) AS last_activity,
                    (
                        SELECT sm_q.content
                        FROM session_messages sm_q
                        WHERE sm_q.session_id = rs.id AND sm_q.role = 'USER'
                        ORDER BY sm_q.created_at ASC
                        LIMIT 1
                    ) AS preview
                FROM research_sessions rs
                JOIN session_messages sm ON sm.session_id = rs.id
                LEFT JOIN chatbot_configs cc ON cc.id = rs.chatbot_config_id
                WHERE rs.user_id = :uid
                GROUP BY rs.id, rs.started_at, cc.display_name
                ORDER BY MAX(sm.created_at) DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"uid": user_id, "limit": limit, "offset": offset},
        )
        items = [
            {
                "session_id": row.session_id,
                "started_at": row.started_at,
                "last_activity": row.last_activity,
                "message_count": row.message_count,
                "chatbot_name": row.chatbot_name,
                "preview": row.preview or "",
            }
            for row in result.all()
        ]
        return items, total

    # --- 메시지 ---

    async def create_message(self, message: SessionMessage) -> SessionMessage:
        self.session.add(message)
        await self.session.flush()
        return message

    async def get_messages_by_session(
        self,
        session_id: uuid.UUID,
        *,
        pipeline_version: int | None = None,
    ) -> list[SessionMessage]:
        """세션 메시지 조회. pipeline_version 지정 시 해당 버전만 필터링.

        N7 (R1 Phase 3): pipeline_version=2 → 신규 파이프라인 메시지만,
        =1 → legacy/backfill 메시지만, None → 모든 버전 (하위 호환).
        """
        stmt = select(SessionMessage).where(
            SessionMessage.session_id == session_id
        )
        if pipeline_version is not None:
            stmt = stmt.where(SessionMessage.pipeline_version == pipeline_version)
        stmt = stmt.order_by(SessionMessage.created_at)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_recent_messages(
        self,
        session_id: uuid.UUID,
        *,
        limit: int = 12,
    ) -> list[SessionMessage]:
        """멀티턴 이력용 최근 메시지 조회 — 최신 limit 건을 시간 오름차순으로 반환.

        get_messages_by_session(limit 없음, 분석 API 용)과 달리 세션이 길어져도
        O(limit) 로 고정된다.
        """
        stmt = (
            select(SessionMessage)
            .where(SessionMessage.session_id == session_id)
            .order_by(SessionMessage.created_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(reversed(result.scalars().all()))

    async def get_message(self, message_id: uuid.UUID) -> SessionMessage | None:
        result = await self.session.execute(
            select(SessionMessage).where(SessionMessage.id == message_id)
        )
        return result.scalar_one_or_none()

    # --- 검색 이벤트 ---

    async def create_search_event(self, event: SearchEvent) -> SearchEvent:
        self.session.add(event)
        await self.session.flush()
        return event

    # --- 인용 ---

    async def create_citations(self, citations: list[AnswerCitation]) -> None:
        for c in citations:
            self.session.add(c)
        await self.session.flush()

    # --- 피드백 (익명 세션별 메시지당 현재 상태 1행, upsert) ---

    async def get_feedback(
        self, message_id: uuid.UUID, user_session_id: str
    ) -> AnswerFeedback | None:
        """(message_id, user_session_id) 현재 피드백 조회. 없으면 None."""
        result = await self.session.execute(
            select(AnswerFeedback).where(
                AnswerFeedback.message_id == message_id,
                AnswerFeedback.user_session_id == user_session_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_feedback(self, feedback: AnswerFeedback) -> AnswerFeedback:
        self.session.add(feedback)
        await self.session.flush()
        return feedback

    async def delete_feedback(
        self, message_id: uuid.UUID, user_session_id: str
    ) -> bool:
        """(message_id, user_session_id) 피드백 삭제(취소). 삭제 대상 유무 반환."""
        existing = await self.get_feedback(message_id, user_session_id)
        if existing is None:
            return False
        await self.session.delete(existing)
        await self.session.flush()
        return True

    async def rollback(self) -> None:
        await self.session.rollback()

    async def commit(self) -> None:
        await self.session.commit()
