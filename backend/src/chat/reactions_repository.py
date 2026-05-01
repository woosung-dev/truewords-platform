"""P1-A — MessageReaction repository.

토글 시맨틱: 동일 (message_id, user_session_id, kind) 가 있으면 delete, 없으면 create.
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.chat.models import MessageReaction, MessageReactionKind


class MessageReactionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_existing(
        self,
        *,
        message_id: uuid.UUID,
        user_session_id: str,
        kind: MessageReactionKind,
    ) -> MessageReaction | None:
        stmt = select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.user_session_id == user_session_id,
            MessageReaction.kind == kind,
        )
        res = await self.session.exec(stmt)
        return res.first()

    async def toggle(
        self,
        *,
        message_id: uuid.UUID,
        user_session_id: str,
        kind: MessageReactionKind,
    ) -> tuple[str, MessageReaction | None]:
        """토글 반환: ("added", reaction) 또는 ("removed", None).

        같은 (message_id, user_session_id, kind) 가 이미 있으면 삭제. 없으면 생성.
        호출자가 commit 책임.
        """
        existing = await self.get_existing(
            message_id=message_id,
            user_session_id=user_session_id,
            kind=kind,
        )
        if existing is not None:
            await self.session.exec(  # type: ignore[call-overload]
                delete(MessageReaction).where(MessageReaction.id == existing.id)
            )
            return "removed", None

        reaction = MessageReaction(
            message_id=message_id,
            user_session_id=user_session_id,
            kind=kind,
        )
        self.session.add(reaction)
        await self.session.flush()
        return "added", reaction

    async def delete_existing(
        self,
        *,
        message_id: uuid.UUID,
        user_session_id: str,
        kind: MessageReactionKind,
    ) -> int:
        """B2 race fallback — race 로 IntegrityError 발생 시 호출.

        해당 (message_id, user_session_id, kind) 의 row 가 *지금* 존재하면 삭제.
        """
        await self.session.exec(  # type: ignore[call-overload]
            delete(MessageReaction).where(
                MessageReaction.message_id == message_id,
                MessageReaction.user_session_id == user_session_id,
                MessageReaction.kind == kind,
            )
        )
        return 1

    async def get_aggregate(
        self, message_id: uuid.UUID
    ) -> dict[MessageReactionKind, int]:
        """message_id 단위 kind별 카운트."""
        stmt = select(MessageReaction).where(
            MessageReaction.message_id == message_id
        )
        res = await self.session.exec(stmt)
        rows = res.all()
        counts: dict[MessageReactionKind, int] = {
            MessageReactionKind.THUMBS_UP: 0,
            MessageReactionKind.THUMBS_DOWN: 0,
            MessageReactionKind.SAVE: 0,
        }
        for row in rows:
            counts[row.kind] = counts.get(row.kind, 0) + 1
        return counts
