"""공개 질문 Repository — AsyncSession 은 여기만 보유한다 (DEC-PWA-025).

원본 질문·답은 chat 도메인 테이블(session_messages·answer_citations)에서 읽기만 한다.
"""

import uuid

from sqlalchemy import and_, delete, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.chat.models import AnswerCitation, MessageRole, ResearchSession, SessionMessage
from app.modules.hoondok.models import PublicQuestion


class PublicQuestionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- 원본(chat) 읽기 -----------------------------------------------------------

    async def get_message(self, message_id: uuid.UUID) -> SessionMessage | None:
        return await self.session.get(SessionMessage, message_id)

    async def get_session_owner(self, session_id: uuid.UUID) -> uuid.UUID | None:
        """채팅 세션의 소유자(user_id). 익명 세션·없는 세션은 None."""
        result = await self.session.execute(select(ResearchSession.user_id).where(ResearchSession.id == session_id))
        return result.scalar_one_or_none()

    async def get_question_before(self, answer: SessionMessage) -> SessionMessage | None:
        """같은 세션에서 답 직전(같은 시각 포함)의 마지막 사용자 질문."""
        result = await self.session.execute(
            select(SessionMessage)
            .where(
                SessionMessage.session_id == answer.session_id,
                SessionMessage.role == MessageRole.USER,
                SessionMessage.created_at <= answer.created_at,
            )
            .order_by(SessionMessage.created_at.desc())
            .limit(1)
        )
        return result.scalars().first()

    async def has_answer_before(self, answer: SessionMessage) -> bool:
        """같은 세션에 이 답보다 먼저 온 답이 있는가 — 있으면 이어 물은 답이다."""
        result = await self.session.execute(
            select(SessionMessage.id)
            .where(
                SessionMessage.session_id == answer.session_id,
                SessionMessage.role == MessageRole.ASSISTANT,
                SessionMessage.created_at < answer.created_at,
            )
            .limit(1)
        )
        return result.first() is not None

    async def list_citations(self, message_id: uuid.UUID, limit: int) -> list[AnswerCitation]:
        result = await self.session.execute(
            select(AnswerCitation)
            .where(AnswerCitation.message_id == message_id)
            .order_by(AnswerCitation.rank_position)
            .limit(limit)
        )
        return list(result.scalars().all())

    # --- 공개 질문 ---------------------------------------------------------------

    async def get(self, question_id: str) -> PublicQuestion | None:
        return await self.session.get(PublicQuestion, question_id)

    async def get_by_message(self, message_id: uuid.UUID) -> PublicQuestion | None:
        result = await self.session.execute(select(PublicQuestion).where(PublicQuestion.message_id == message_id))
        return result.scalar_one_or_none()

    async def list_for_user(self, user_id: uuid.UUID) -> list[PublicQuestion]:
        result = await self.session.execute(
            select(PublicQuestion)
            .where(PublicQuestion.user_id == user_id)
            .order_by(PublicQuestion.created_at.desc(), PublicQuestion.id)
        )
        return list(result.scalars().all())

    async def list_published(
        self, q: str | None, after: PublicQuestion | None, limit: int
    ) -> list[PublicQuestion]:
        """published 만, 공개 시각(reviewed_at)·id 내림차순. after 는 직전 페이지 마지막 행(keyset)."""
        query = select(PublicQuestion).where(PublicQuestion.status == "published")
        if q:
            escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.where(PublicQuestion.question.ilike(f"%{escaped}%", escape="\\"))
        if after is not None:
            query = query.where(
                or_(
                    PublicQuestion.reviewed_at < after.reviewed_at,
                    and_(PublicQuestion.reviewed_at == after.reviewed_at, PublicQuestion.id < after.id),
                )
            )
        query = query.order_by(PublicQuestion.reviewed_at.desc(), PublicQuestion.id.desc()).limit(limit)
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def page(self, status: str | None, offset: int, limit: int) -> tuple[list[PublicQuestion], int]:
        """admin 목록 — 신청 오래된 순(검수 대기열). 전체 건수를 함께 돌려준다."""
        query = select(PublicQuestion)
        count = select(func.count()).select_from(PublicQuestion)
        if status is not None:
            query = query.where(PublicQuestion.status == status)
            count = count.where(PublicQuestion.status == status)
        total = int((await self.session.execute(count)).scalar_one())
        result = await self.session.execute(
            query.order_by(PublicQuestion.created_at, PublicQuestion.id).offset(offset).limit(limit)
        )
        return list(result.scalars().all()), total

    async def save(self, question: PublicQuestion, *, commit: bool = True) -> PublicQuestion:
        """커밋 실패(IntegrityError 포함)는 롤백 뒤 그대로 올린다 — 서비스가 409 로 바꾼다."""
        self.session.add(question)
        try:
            if commit:
                await self.session.commit()
            else:
                await self.session.flush()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(question)
        return question

    async def delete(self, question: PublicQuestion) -> None:
        await self.session.delete(question)
        await self.session.commit()

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """UserDataPurger 규약 — 커밋하지 않는다. 사용자 저장 커밋에 함께 묶인다."""
        await self.session.execute(delete(PublicQuestion).where(PublicQuestion.user_id == user_id))
