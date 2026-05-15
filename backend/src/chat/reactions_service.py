# MessageReaction 토글 + 집계 service. router 는 HTTP 레이어, service 는 비즈니스 + race fallback.
"""MessageReactionService — P0-4 audit fix.

audit 이전 reactions_router 는 직접 AsyncSession import + Repository 인라인
인스턴스화 + session.commit/rollback 까지 수행해 룰 §3 "Router DB 접근 금지" 를
직접 위반했다. 본 service 가 비즈니스 로직 + 트랜잭션 경계 + race fallback 을
담당하고 router 는 HTTP 수신 + 스키마 변환만 한다.
"""

from __future__ import annotations

import uuid

from sqlalchemy.exc import IntegrityError

from src.chat.models import MessageReaction, MessageReactionKind
from src.chat.reactions_repository import MessageReactionRepository


class MessageReactionService:
    def __init__(self, repo: MessageReactionRepository) -> None:
        self.repo = repo

    async def toggle(
        self,
        *,
        message_id: uuid.UUID,
        user_session_id: str,
        kind: MessageReactionKind,
    ) -> tuple[str, MessageReaction | None]:
        """단일 반응 토글. race 발생 시 removed 로 graceful 전환.

        race 시나리오: 두 동시 요청이 모두 existing=None 으로 읽고 INSERT 시도 →
        두 번째가 unique 위반. 사용자 의도는 "토글" 이므로 removed 로 정착.
        """
        try:
            action, reaction = await self.repo.toggle(
                message_id=message_id,
                user_session_id=user_session_id,
                kind=kind,
            )
            await self.repo.commit()
            return action, reaction
        except IntegrityError:
            await self.repo.rollback()
            await self.repo.delete_existing(
                message_id=message_id,
                user_session_id=user_session_id,
                kind=kind,
            )
            await self.repo.commit()
            return "removed", None

    async def get_aggregate(
        self, message_id: uuid.UUID
    ) -> dict[MessageReactionKind, int]:
        return await self.repo.get_aggregate(message_id)
