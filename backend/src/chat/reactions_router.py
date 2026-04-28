"""P1-A — 답변 반응 (👍/👎/💾) endpoint.

ADR-46 §C.3 답변 평가 영역. AnswerFeedback router 와 분리된 별도 라우트.
인증: 비로그인 사용자도 토글 가능 — user_session_id 를 클라이언트가 발급.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from src.chat.models import MessageReactionKind
from src.chat.reactions_repository import MessageReactionRepository
from src.chat.reactions_schemas import (
    ReactionAggregate,
    ReactionRequest,
    ReactionResponse,
    ReactionToggleResponse,
)
from src.common.database import get_async_session
from sqlmodel.ext.asyncio.session import AsyncSession

reactions_router = APIRouter(
    prefix="/api/chat/messages",
    tags=["chat-reactions"],
)


@reactions_router.post(
    "/{message_id}/reaction",
    response_model=ReactionToggleResponse,
)
async def toggle_reaction(
    message_id: uuid.UUID,
    payload: ReactionRequest,
    session: AsyncSession = Depends(get_async_session),
) -> ReactionToggleResponse:
    """단일 반응 토글 (P1-A).

    동일 (message_id, user_session_id, kind) 가 이미 있으면 제거, 없으면 추가.
    """
    try:
        kind_enum = MessageReactionKind(payload.kind)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="알 수 없는 reaction kind") from exc

    repo = MessageReactionRepository(session)
    action, reaction = await repo.toggle(
        message_id=message_id,
        user_session_id=payload.user_session_id,
        kind=kind_enum,
    )
    await session.commit()

    return ReactionToggleResponse(
        action="added" if action == "added" else "removed",
        reaction=(
            ReactionResponse(
                id=reaction.id,
                message_id=reaction.message_id,
                user_session_id=reaction.user_session_id,
                kind=reaction.kind.value,  # type: ignore[arg-type]
                created_at=reaction.created_at,
            )
            if reaction is not None
            else None
        ),
    )


@reactions_router.get(
    "/{message_id}/reactions",
    response_model=ReactionAggregate,
)
async def get_aggregate(
    message_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
) -> ReactionAggregate:
    """단일 message_id 의 반응 카운트 (UI badge 용)."""
    repo = MessageReactionRepository(session)
    counts = await repo.get_aggregate(message_id)
    return ReactionAggregate(
        message_id=message_id,
        thumbs_up=counts.get(MessageReactionKind.THUMBS_UP, 0),
        thumbs_down=counts.get(MessageReactionKind.THUMBS_DOWN, 0),
        save=counts.get(MessageReactionKind.SAVE, 0),
    )
