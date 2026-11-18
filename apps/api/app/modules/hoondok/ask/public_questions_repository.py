"""공개 질문 Repository — AsyncSession 은 여기만 보유한다 (DEC-PWA-025).

공개 목록 정렬: 고정(pin_order) → 인기도(view_count + 3 × ask_count) → 공개 시각 → id. 페이지는 offset 기반이다.

원본 질문·답은 chat 도메인 테이블(session_messages·answer_citations)에서 읽기만 한다.
"""

import hashlib
import uuid
from datetime import date, timedelta
from typing import Literal

from sqlalchemy import delete, func, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.common.clock import utcnow
from app.modules.chat.models import AnswerCitation, MessageRole, ResearchSession, SessionMessage
from app.modules.hoondok.models import PublicQuestion, PublicQuestionAsk, PublicQuestionView

# 인기도 = 조회 수 + 가중치 × 질문 수. 질문(새로 물어 답을 받음)이 조회보다 강한 관심 신호라 3배로 센다.
POPULARITY_ASK_WEIGHT = 3
# 조회 중복 방지 행 보관일 — 오늘 - 2일보다 오래된 행은 새 행을 넣을 때 지운다.
VIEW_RETENTION_DAYS = 2

AdminSort = Literal["oldest", "newest", "popular"]


def popularity_score():
    """SQL 인기도 식(view_count + 3 * ask_count)."""
    return PublicQuestion.view_count + POPULARITY_ASK_WEIGHT * PublicQuestion.ask_count


def viewer_key(kind: Literal["u", "a"], value: uuid.UUID) -> str:
    """조회자 키 — 사용자(u)·익명(a) id 의 sha256 hex. 원본 id 는 저장하지 않는다."""
    return hashlib.sha256(f"{kind}:{value}".encode()).hexdigest()


def _escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


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

    async def list_published(self, q: str | None, offset: int, limit: int) -> list[PublicQuestion]:
        """published 만. 고정(pin_order 작은 순, 없으면 뒤) → 인기도 내림차순 → 공개 시각 → id 내림차순."""
        query = select(PublicQuestion).where(PublicQuestion.status == "published")
        if q:
            query = query.where(PublicQuestion.question.ilike(f"%{_escape_like(q)}%", escape="\\"))
        query = (
            query.order_by(
                PublicQuestion.pin_order.is_(None),
                PublicQuestion.pin_order,
                popularity_score().desc(),
                PublicQuestion.reviewed_at.desc(),
                PublicQuestion.id.desc(),
            )
            .offset(offset)
            .limit(limit)
        )
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def page(
        self, status: str | None, q: str | None, sort: AdminSort, offset: int, limit: int
    ) -> tuple[list[PublicQuestion], int]:
        """admin 목록 — 기본은 신청 오래된 순(검수 대기열). 전체 건수를 함께 돌려준다."""
        query = select(PublicQuestion)
        count = select(func.count()).select_from(PublicQuestion)
        if status is not None:
            query = query.where(PublicQuestion.status == status)
            count = count.where(PublicQuestion.status == status)
        if q:
            clause = PublicQuestion.question.ilike(f"%{_escape_like(q)}%", escape="\\")
            query = query.where(clause)
            count = count.where(clause)
        total = int((await self.session.execute(count)).scalar_one())
        if sort == "newest":
            order = (PublicQuestion.created_at.desc(), PublicQuestion.id)
        elif sort == "popular":
            order = (popularity_score().desc(), PublicQuestion.created_at.desc(), PublicQuestion.id)
        else:
            order = (PublicQuestion.created_at, PublicQuestion.id)
        result = await self.session.execute(query.order_by(*order).offset(offset).limit(limit))
        return list(result.scalars().all()), total

    async def list_pins(self) -> list[PublicQuestion]:
        """고정된 질문 — pin_order 순."""
        result = await self.session.execute(
            select(PublicQuestion).where(PublicQuestion.pin_order.is_not(None)).order_by(PublicQuestion.pin_order, PublicQuestion.id)  # type: ignore[union-attr]
        )
        return list(result.scalars().all())

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

    # --- 인기도 -------------------------------------------------------------------

    def _insert(self):
        return pg_insert if self.session.get_bind().dialect.name == "postgresql" else sqlite_insert

    async def record_view(self, question_id: str, key: str, today: date) -> bool:
        """(질문, 조회자, 오늘) 첫 조회면 행을 넣고 view_count 를 원자적으로 올린다. 이미 셌으면 False. 커밋한다.

        동시 요청이 같은 행을 넣으면 한쪽만 rowcount 1 이라 한 번만 센다(unique PK + ON CONFLICT DO NOTHING).
        """
        try:
            result = await self.session.execute(
                self._insert()(PublicQuestionView)
                .values(question_id=question_id, viewer_key=key, day=today)
                .on_conflict_do_nothing()
            )
            if result.rowcount != 1:  # type: ignore[attr-defined]
                await self.session.rollback()
                return False
            await self.session.execute(
                update(PublicQuestion)
                .where(PublicQuestion.id == question_id)
                .values(view_count=PublicQuestion.view_count + 1)
                .execution_options(synchronize_session=False)
            )
            await self.session.execute(
                delete(PublicQuestionView)
                .where(PublicQuestionView.day < today - timedelta(days=VIEW_RETENTION_DAYS))
                .execution_options(synchronize_session=False)
            )
            await self.session.commit()
            return True
        except IntegrityError:
            await self.session.rollback()
            return False

    async def record_ask(self, question_id: str, user_id: uuid.UUID) -> bool:
        """계정당 질문 1회만 ask_count 를 올린다. 이미 셌거나 공개 질문이 아니면 False. 커밋한다."""
        try:
            published = await self.session.execute(
                select(PublicQuestion.id).where(PublicQuestion.id == question_id, PublicQuestion.status == "published")
            )
            if published.first() is None:
                return False
            result = await self.session.execute(
                self._insert()(PublicQuestionAsk)
                .values(question_id=question_id, user_id=user_id, created_at=utcnow())
                .on_conflict_do_nothing()
            )
            if result.rowcount != 1:  # type: ignore[attr-defined]
                await self.session.rollback()
                return False
            await self.session.execute(
                update(PublicQuestion)
                .where(PublicQuestion.id == question_id)
                .values(ask_count=PublicQuestion.ask_count + 1)
                .execution_options(synchronize_session=False)
            )
            await self.session.commit()
            return True
        except IntegrityError:
            await self.session.rollback()
            return False

    async def _delete_children(self, question_ids) -> None:
        """조회·질문 중복 방지 행을 먼저 지운다(DB cascade 에 기대지 않는다). 커밋하지 않는다."""
        for model in (PublicQuestionView, PublicQuestionAsk):
            await self.session.execute(
                delete(model).where(model.question_id.in_(question_ids)).execution_options(synchronize_session=False)
            )

    async def delete(self, question: PublicQuestion) -> None:
        await self._delete_children([question.id])
        await self.session.delete(question)
        await self.session.commit()

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """UserDataPurger 규약 — 커밋하지 않는다. 사용자 저장 커밋에 함께 묶인다.

        내 공개 질문의 자식 행, 내가 다른 질문에 남긴 질문 행(ask)·조회 행(viewer_key=해시)도 함께 지운다.
        남의 질문에 이미 올라간 view_count·ask_count 는 익명 집계라 되돌리지 않는다.
        """
        mine = select(PublicQuestion.id).where(PublicQuestion.user_id == user_id)
        await self._delete_children(mine)
        await self.session.execute(
            delete(PublicQuestionAsk).where(PublicQuestionAsk.user_id == user_id).execution_options(synchronize_session=False)
        )
        await self.session.execute(
            delete(PublicQuestionView)
            .where(PublicQuestionView.viewer_key == viewer_key("u", user_id))
            .execution_options(synchronize_session=False)
        )
        await self.session.execute(delete(PublicQuestion).where(PublicQuestion.user_id == user_id))
