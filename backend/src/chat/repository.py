"""채팅 Repository. 세션, 메시지, 검색 이벤트, 인용, 피드백 DB 접근."""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.chat.models import (
    AnswerCitation,
    AnswerFeedback,
    MessageRole,
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

    # --- 피드백 ---

    async def create_feedback(self, feedback: AnswerFeedback) -> AnswerFeedback:
        self.session.add(feedback)
        await self.session.flush()
        return feedback

    # --- 인기 질문 (P1-C) ---

    async def get_popular_questions(
        self,
        chatbot_id: uuid.UUID,
        *,
        period_days: int | None = 7,
        limit: int = 10,
        min_count: int = 1,
    ) -> list[tuple[str, int]]:
        """특정 챗봇의 인기 질문 (USER 메시지 content) 집계.

        - ``chatbot_id`` (= ``ChatbotConfig.id``) 의 ResearchSession 에 속한
          USER 메시지의 content 를 group by + count.
        - ``period_days`` 가 None 이면 전체 기간 (period=all).
        - ``min_count`` 미만은 결과에서 제외 (B6 k-anonymity / PII 보호).
          public endpoint 는 3 (k=3), admin endpoint 는 1.

        Returns:
            list of (question_text, count) — count desc.
        """
        stmt = (
            select(
                SessionMessage.content,
                func.count(SessionMessage.id).label("cnt"),
            )
            .join(
                ResearchSession,
                ResearchSession.id == SessionMessage.session_id,
            )
            .where(
                ResearchSession.chatbot_config_id == chatbot_id,
                SessionMessage.role == MessageRole.USER,
            )
            .group_by(SessionMessage.content)
            .having(func.count(SessionMessage.id) >= min_count)
            .order_by(desc("cnt"))
            .limit(limit)
        )
        if period_days is not None and period_days > 0:
            cutoff = datetime.utcnow() - timedelta(days=period_days)
            stmt = stmt.where(SessionMessage.created_at >= cutoff)

        result = await self.session.execute(stmt)
        return [(row[0], int(row[1])) for row in result.all()]

    async def commit(self) -> None:
        await self.session.commit()
