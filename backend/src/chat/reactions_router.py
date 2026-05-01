"""P1-A — 답변 반응 (👍/👎/💾) endpoint.

ADR-46 §C.3 답변 평가 영역. AnswerFeedback router 와 분리된 별도 라우트.

# B2 보안 (Cross-review Codex + Sonnet 합의)
- ``user_session_id`` 를 **서버가 HttpOnly cookie 로 발급/관리**한다. 클라이언트
  임의 입력 → 무한 fingerprint 스팸 차단.
- IP 단위 **rate limit** (RATE_LIMIT_MAX_REQUESTS 의 5x 적용 — 토글 UX 가 일반
  요청보다 빈번할 수 있음).
- toggle 은 **atomic** 처리: read→insert 경합 시 IntegrityError 를 catch 해서
  "이미 존재 → 삭제" 로 graceful 전환 (Sonnet review #3).
"""

from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlmodel.ext.asyncio.session import AsyncSession

from src.chat.models import MessageReactionKind
from src.chat.reactions_repository import MessageReactionRepository
from src.chat.reactions_schemas import (
    ReactionAggregate,
    ReactionRequest,
    ReactionResponse,
    ReactionToggleResponse,
)
from src.common.database import get_async_session
from src.config import settings
from src.safety.exceptions import RateLimitExceededError
from src.safety.rate_limiter import RateLimiter, get_rate_limiter

reactions_router = APIRouter(
    prefix="/api/chat/messages",
    tags=["chat-reactions"],
)

# B2 — HttpOnly cookie 이름. 비로그인 익명 세션 식별용.
ANON_SESSION_COOKIE = "tw_anon_session"
ANON_SESSION_MAX_AGE = 60 * 60 * 24 * 365  # 1 year
# B2 — reactions 전용 별도 RateLimiter (일반 채팅 quota 와 분리, 토글 UX 가 빈번)
_reactions_rate_limiter: RateLimiter | None = None


def get_reactions_rate_limiter() -> RateLimiter:
    global _reactions_rate_limiter
    if _reactions_rate_limiter is None:
        _reactions_rate_limiter = RateLimiter(
            max_requests=settings.rate_limit_max_requests * 5,
            window_seconds=settings.rate_limit_window_seconds,
        )
    return _reactions_rate_limiter


def _get_or_issue_session_id(request: Request, response: Response) -> str:
    """B2 — anon session id 를 cookie 에서 읽거나 새로 발급해서 Set-Cookie."""
    existing = request.cookies.get(ANON_SESSION_COOKIE)
    if existing and 16 <= len(existing) <= 128:
        return existing
    new_id = secrets.token_urlsafe(24)  # 32 chars URL-safe
    response.set_cookie(
        ANON_SESSION_COOKIE,
        new_id,
        max_age=ANON_SESSION_MAX_AGE,
        httponly=True,
        secure=getattr(settings, "cookie_secure", False),
        samesite="lax",
    )
    return new_id


def _client_ip(request: Request) -> str:
    """B2 — rate limit 키. proxy 헤더 우선, 없으면 socket peer."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


@reactions_router.post(
    "/{message_id}/reaction",
    response_model=ReactionToggleResponse,
)
async def toggle_reaction(
    message_id: uuid.UUID,
    payload: ReactionRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_async_session),
    rate_limiter: RateLimiter = Depends(get_reactions_rate_limiter),
) -> ReactionToggleResponse:
    """단일 반응 토글 (P1-A).

    인증/세션:
        - HttpOnly cookie ``tw_anon_session`` 에서 user_session_id 를 읽어 사용한다.
        - 쿠키 부재 시 서버가 즉시 발급해 Set-Cookie 헤더로 전달.
        - 클라이언트는 user_session_id 를 직접 제공할 수 없다.

    Rate limit:
        - IP 기준. 초과 시 ``RateLimitExceededError``.

    토글 시맨틱 (atomic):
        - 동일 (message_id, anon_session, kind) 가 있으면 제거.
        - 없으면 INSERT 시도 → ``IntegrityError`` 발생 시 (race) 이미 존재로
          판단해 "removed" 반환.
    """
    rate_limiter.check(_client_ip(request))

    try:
        kind_enum = MessageReactionKind(payload.kind)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="알 수 없는 reaction kind") from exc

    user_session_id = _get_or_issue_session_id(request, response)

    repo = MessageReactionRepository(session)
    try:
        action, reaction = await repo.toggle(
            message_id=message_id,
            user_session_id=user_session_id,
            kind=kind_enum,
        )
        await session.commit()
    except IntegrityError:
        # B2 — race: 두 동시 요청이 모두 existing=None 으로 읽고 INSERT 시도 →
        # 두 번째가 unique 위반. 사용자 의도는 "토글" 이므로 removed 로 정착.
        await session.rollback()
        await repo.delete_existing(
            message_id=message_id,
            user_session_id=user_session_id,
            kind=kind_enum,
        )
        await session.commit()
        return ReactionToggleResponse(action="removed", reaction=None)

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
    """단일 message_id 의 반응 카운트 (UI badge 용). 인증 불필요 (집계만)."""
    repo = MessageReactionRepository(session)
    counts = await repo.get_aggregate(message_id)
    return ReactionAggregate(
        message_id=message_id,
        thumbs_up=counts.get(MessageReactionKind.THUMBS_UP, 0),
        thumbs_down=counts.get(MessageReactionKind.THUMBS_DOWN, 0),
        save=counts.get(MessageReactionKind.SAVE, 0),
    )


# RateLimitExceededError 는 main.py 의 글로벌 핸들러가 ErrorResponse 로 변환.
__all__ = [
    "reactions_router",
    "get_reactions_rate_limiter",
    "RateLimitExceededError",
]
