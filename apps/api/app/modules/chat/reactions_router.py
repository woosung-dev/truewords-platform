"""P1-A — 답변 반응 (👍/👎/💾) endpoint.

ADR-46 §C.3 답변 평가 영역. AnswerFeedback router 와 분리된 별도 라우트.

# B2 보안 (Cross-review Codex + Sonnet 합의)
- ``user_session_id`` 를 **서버가 HttpOnly cookie 로 발급/관리**한다. 클라이언트
  임의 입력 → 무한 fingerprint 스팸 차단.
- IP 단위 **rate limit** (RATE_LIMIT_MAX_REQUESTS 의 5x 적용 — 토글 UX 가 일반
  요청보다 빈번할 수 있음).
- toggle 은 **atomic** 처리: read→insert 경합 시 IntegrityError 를 catch 해서
  "이미 존재 → 삭제" 로 graceful 전환 (`MessageReactionService` 내부 처리).

audit P0-4 fix (2026-05-15): AsyncSession + Repository 직접 보유 + session.commit/
rollback 호출을 모두 `MessageReactionService` 로 이관 (룰 §3 "Router DB 접근 금지"
+ "AsyncSession 은 Repository 만"). 본 파일은 HTTP 수신 + cookie 발급 + rate
limit + 스키마 변환만 담당.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.modules.chat.anon_session import get_or_issue_session_id
from app.modules.chat.dependencies import get_reactions_service
from app.modules.chat.models import MessageReactionKind
from app.modules.chat.reactions_schemas import (
    ReactionAggregate,
    ReactionRequest,
    ReactionResponse,
    ReactionToggleResponse,
)
from app.modules.chat.reactions_service import MessageReactionService
from app.core.config import settings
from app.modules.safety.exceptions import RateLimitExceededError
from app.modules.safety.middleware import extract_client_ip as _client_ip
from app.modules.safety.rate_limiter import RateLimiter

reactions_router = APIRouter(
    prefix="/api/chat/messages",
    tags=["chat-reactions"],
)

# B2 — reactions 전용 별도 RateLimiter (일반 채팅 quota 와 분리, 토글 UX 가 빈번)
# 익명 세션 쿠키 헬퍼는 chat/anon_session.py 로 이관 (feedback 경로와 공유).
_reactions_rate_limiter: RateLimiter | None = None


def get_reactions_rate_limiter() -> RateLimiter:
    global _reactions_rate_limiter
    if _reactions_rate_limiter is None:
        _reactions_rate_limiter = RateLimiter(
            max_requests=settings.rate_limit_max_requests * 5,
            window_seconds=settings.rate_limit_window_seconds,
        )
    return _reactions_rate_limiter


# audit 2차 C-3 (2026-05-15): 자체 _client_ip helper 제거. safety/middleware
# .extract_client_ip 단일 진입점으로 통일. XFF 파싱 로직이 두 곳에 흩어져 있으면
# 다음 보안 fix 때 한 곳만 갱신될 위험.


@reactions_router.post(
    "/{message_id}/reaction",
    response_model=ReactionToggleResponse,
)
async def toggle_reaction(
    message_id: uuid.UUID,
    payload: ReactionRequest,
    request: Request,
    response: Response,
    service: MessageReactionService = Depends(get_reactions_service),
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
          판단해 "removed" 반환 (service 내부에서 처리).
    """
    rate_limiter.check(_client_ip(request))

    try:
        kind_enum = MessageReactionKind(payload.kind)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="알 수 없는 reaction kind") from exc

    user_session_id = get_or_issue_session_id(request, response)

    action, reaction = await service.toggle(
        message_id=message_id,
        user_session_id=user_session_id,
        kind=kind_enum,
    )

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
    service: MessageReactionService = Depends(get_reactions_service),
) -> ReactionAggregate:
    """단일 message_id 의 반응 카운트 (UI badge 용). 인증 불필요 (집계만)."""
    counts = await service.get_aggregate(message_id)
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
