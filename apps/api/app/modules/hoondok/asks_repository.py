"""훈독 AI 질문 Repository (DEC-PWA-025 2차) — AsyncSession 은 여기만 보유한다.

질문·답 원문은 chat 도메인 테이블에서 읽는다. 대화 삭제·계정 삭제 때는 그 세션의 chat 행도 자식부터 함께 지운다
(훈독 계정 세션은 훈독 화면에서만 열리므로 다른 곳에서 참조하지 않는다).
"""

import uuid
from datetime import date

from sqlalchemy import delete, func, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.chat.models import (
    AnswerCitation,
    AnswerFeedback,
    MessageReaction,
    MessageRole,
    ResearchSession,
    SearchEvent,
    SessionMessage,
)
from app.modules.hoondok.models import AskThread, AskTurn, AskUsage, PublicQuestion


class AskRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- 하루 횟수 -------------------------------------------------------------------

    async def used_on(self, user_id: uuid.UUID, day: date) -> int:
        result = await self.session.execute(
            select(AskUsage.used).where(AskUsage.user_id == user_id, AskUsage.day == day)
        )
        return int(result.scalar_one_or_none() or 0)

    async def try_consume(self, user_id: uuid.UUID, day: date, limit: int) -> bool:
        """1회 차감. 상한에 닿았으면 False. 커밋까지 한다(스트림 시작 전에 확정).

        행을 먼저 만들어 두고(ON CONFLICT DO NOTHING) 조건부 UPDATE 로 올린다. Postgres 는 같은 행 UPDATE 를 행 잠금으로
        직렬화하고 잠금을 얻은 뒤 `used < limit` 을 다시 평가하므로, 동시 요청이 몰려도 limit 을 넘지 않는다.
        """
        dialect = self.session.get_bind().dialect.name
        insert = pg_insert if dialect == "postgresql" else sqlite_insert
        await self.session.execute(
            insert(AskUsage).values(user_id=user_id, day=day, used=0).on_conflict_do_nothing()
        )
        result = await self.session.execute(
            update(AskUsage)
            .where(AskUsage.user_id == user_id, AskUsage.day == day, AskUsage.used < limit)
            .values(used=AskUsage.used + 1)
            .execution_options(synchronize_session=False)
        )
        await self.session.commit()
        return result.rowcount == 1  # type: ignore[attr-defined]

    async def refund(self, user_id: uuid.UUID, day: date) -> None:
        """차감 1회 되돌리기 — 답을 만들기 전에 실패한 요청.

        같은 요청 세션을 채팅 파이프라인이 쓰다가 예외로 끝났을 수 있어 먼저 롤백한다(커밋 전 질문 메시지만 버려진다).
        차감한 날(day)을 그대로 받아 자정을 넘긴 실패도 그날 몫으로 되돌린다.
        """
        await self.session.rollback()
        await self.session.execute(
            update(AskUsage)
            .where(AskUsage.user_id == user_id, AskUsage.day == day, AskUsage.used > 0)
            .values(used=AskUsage.used - 1)
            .execution_options(synchronize_session=False)
        )
        await self.session.commit()

    # --- 대화 ------------------------------------------------------------------------

    async def get_thread(self, session_id: uuid.UUID) -> AskThread | None:
        return await self.session.get(AskThread, session_id)

    async def record_turn(self, turn: AskTurn) -> None:
        """답 1개 기록. 첫 답이면 대화(thread)도 만든다. 커밋한다."""
        if await self.session.get(AskThread, turn.session_id) is None:
            self.session.add(AskThread(session_id=turn.session_id, user_id=turn.user_id))
            await self.session.flush()
        if await self.session.get(AskTurn, turn.message_id) is None:
            self.session.add(turn)
        await self.session.commit()

    async def rollback(self) -> None:
        await self.session.rollback()

    async def set_saved(self, thread: AskThread, saved: bool) -> None:
        thread.saved = saved
        self.session.add(thread)
        await self.session.commit()

    async def list_threads(self, user_id: uuid.UUID, limit: int) -> list[tuple[AskThread, object, int]]:
        """(대화, 마지막 답 시각, 답 수) — 마지막 답 시각 내림차순."""
        last_at = func.max(AskTurn.created_at)
        result = await self.session.execute(
            select(AskThread, last_at, func.count(AskTurn.message_id))
            .join(AskTurn, AskTurn.session_id == AskThread.session_id)
            .where(AskThread.user_id == user_id)
            .group_by(AskThread.session_id)
            .order_by(last_at.desc(), AskThread.session_id)
            .limit(limit)
        )
        return [(row[0], row[1], int(row[2])) for row in result.all()]

    async def list_turns(self, session_ids: list[uuid.UUID]) -> list[AskTurn]:
        if not session_ids:
            return []
        result = await self.session.execute(
            select(AskTurn).where(AskTurn.session_id.in_(session_ids)).order_by(AskTurn.created_at, AskTurn.message_id)
        )
        return list(result.scalars().all())

    async def list_messages(self, session_ids: list[uuid.UUID]) -> list[SessionMessage]:
        if not session_ids:
            return []
        result = await self.session.execute(
            select(SessionMessage)
            .where(SessionMessage.session_id.in_(session_ids))
            .order_by(SessionMessage.created_at, SessionMessage.id)
        )
        return list(result.scalars().all())

    async def list_first_questions(self, session_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
        """세션별 첫 사용자 질문."""
        if not session_ids:
            return {}
        first = (
            select(SessionMessage.session_id, func.min(SessionMessage.created_at).label("first_at"))
            .where(SessionMessage.session_id.in_(session_ids), SessionMessage.role == MessageRole.USER)
            .group_by(SessionMessage.session_id)
            .subquery()
        )
        result = await self.session.execute(
            select(SessionMessage.session_id, SessionMessage.content)
            .join(
                first,
                (first.c.session_id == SessionMessage.session_id) & (first.c.first_at == SessionMessage.created_at),
            )
            .where(SessionMessage.role == MessageRole.USER)
        )
        questions: dict[uuid.UUID, str] = {}
        for session_id, content in result.all():
            questions.setdefault(session_id, content)
        return questions

    async def list_public_questions(self, user_id: uuid.UUID, message_ids: list[uuid.UUID]) -> list[PublicQuestion]:
        if not message_ids:
            return []
        result = await self.session.execute(
            select(PublicQuestion).where(PublicQuestion.user_id == user_id, PublicQuestion.message_id.in_(message_ids))
        )
        return list(result.scalars().all())

    # --- 삭제 ------------------------------------------------------------------------

    async def _delete_sessions(self, session_ids) -> None:
        """세션 묶음(서브쿼리)과 그 아래 행을 자식부터 지운다. 커밋하지 않는다."""
        message_ids = select(SessionMessage.id).where(SessionMessage.session_id.in_(session_ids))
        await self._bulk(delete(AskTurn).where(AskTurn.session_id.in_(session_ids)))
        for model in (AnswerFeedback, MessageReaction, SearchEvent, AnswerCitation):
            await self._bulk(delete(model).where(model.message_id.in_(message_ids)))
        await self._bulk(delete(SessionMessage).where(SessionMessage.session_id.in_(session_ids)))
        await self._bulk(delete(AskThread).where(AskThread.session_id.in_(session_ids)))
        await self._bulk(delete(ResearchSession).where(ResearchSession.id.in_(session_ids)))

    async def _bulk(self, statement) -> None:
        await self.session.execute(statement.execution_options(synchronize_session=False))

    async def delete_thread(self, session_id: uuid.UUID) -> None:
        """대화 1건 삭제(커밋). 공개 신청 복사본(hoondok_public_questions)은 지우지 않는다 — 서비스 주석 참고."""
        await self._delete_sessions([session_id])
        await self.session.commit()

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """UserDataPurger 규약 — 커밋하지 않는다. 사용자 저장 커밋에 함께 묶인다.

        thread 가 없는 세션(첫 답 전에 끊긴 요청)도 research_sessions.user_id 로 함께 지운다.
        """
        owned = select(ResearchSession.id).where(ResearchSession.user_id == user_id)
        await self._bulk(delete(AskTurn).where(AskTurn.user_id == user_id))
        await self._delete_sessions(owned)
        await self._bulk(delete(AskThread).where(AskThread.user_id == user_id))
        await self._bulk(delete(AskUsage).where(AskUsage.user_id == user_id))
