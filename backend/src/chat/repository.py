"""채팅 Repository. 세션, 메시지, 검색 이벤트, 인용, 피드백 DB 접근."""

import uuid

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

    async def commit(self) -> None:
        await self.session.commit()
