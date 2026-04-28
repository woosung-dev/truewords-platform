"""P1-H — ChatMessageNote repository.

Atomic upsert 시맨틱: UNIQUE (message_id, chunk_id, user_session_id) 위에서
- 존재하면 body / updated_at UPDATE,
- 없으면 INSERT.

동시 요청 race 는 IntegrityError 를 catch 해서 재조회 + UPDATE 로 복구한다.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.chat.models import ChatMessageNote


class ChatMessageNoteRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(
        self,
        *,
        message_id: uuid.UUID,
        chunk_id: str,
        user_session_id: str,
    ) -> ChatMessageNote | None:
        stmt = select(ChatMessageNote).where(
            ChatMessageNote.message_id == message_id,
            ChatMessageNote.chunk_id == chunk_id,
            ChatMessageNote.user_session_id == user_session_id,
        )
        res = await self.session.exec(stmt)
        return res.first()

    async def upsert(
        self,
        *,
        message_id: uuid.UUID,
        chunk_id: str,
        user_session_id: str,
        body: str,
    ) -> ChatMessageNote:
        """UPDATE OR INSERT — 호출자가 commit 책임.

        race 보호:
            - 동시 INSERT 두 건이 모두 existing=None 으로 읽어 INSERT 시도하면
              UNIQUE 위반 발생. flush() 단계에서 IntegrityError 를 catch 해서
              rollback 후 재조회 + UPDATE 로 복구.
        """
        existing = await self.get(
            message_id=message_id,
            chunk_id=chunk_id,
            user_session_id=user_session_id,
        )
        if existing is not None:
            existing.body = body
            existing.updated_at = datetime.utcnow()
            self.session.add(existing)
            await self.session.flush()
            return existing

        note = ChatMessageNote(
            message_id=message_id,
            chunk_id=chunk_id,
            user_session_id=user_session_id,
            body=body,
        )
        self.session.add(note)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            recovered = await self.get(
                message_id=message_id,
                chunk_id=chunk_id,
                user_session_id=user_session_id,
            )
            if recovered is None:
                # 매우 드문 경우 — 재시도 없이 그대로 raise.
                raise
            recovered.body = body
            recovered.updated_at = datetime.utcnow()
            self.session.add(recovered)
            await self.session.flush()
            return recovered

        return note
