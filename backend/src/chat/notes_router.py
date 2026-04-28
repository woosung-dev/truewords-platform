"""P1-H — 인용 카드 노트 endpoint.

ADR-46 §C.3 인용 카드 3-탭 (해설 / 본문 / 노트) 의 노트 영속화.

# 보안
- ``user_session_id`` 를 **서버가 HttpOnly cookie 로 발급/관리**한다 (B2 동일).
- 클라이언트 입력 아님 — fingerprint 스팸 차단.
- IP 단위 rate limit (reactions 와 별도 limiter, 노트 입력 빈도 고려).

# 시맨틱
- ``PUT`` 는 atomic upsert (UPDATE 또는 INSERT). 동일 카드 반복 저장 시 in-place
  UPDATE 로 단일 row 유지.
- ``GET`` 은 본인 노트만 반환 (cookie 의 anon session 기준).
"""

from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlmodel.ext.asyncio.session import AsyncSession

from src.chat.notes_repository import ChatMessageNoteRepository
from src.chat.notes_schemas import (
    CHUNK_ID_MAX_LENGTH,
    CitationNoteResponse,
    CitationNoteUpsertRequest,
)
from src.common.database import get_async_session
from src.config import settings
from src.safety.rate_limiter import RateLimiter

notes_router = APIRouter(
    prefix="/api/chat/messages",
    tags=["chat-notes"],
)

# B2 와 동일 cookie 이름 — 같은 익명 세션 식별자를 공유한다.
ANON_SESSION_COOKIE = "tw_anon_session"
ANON_SESSION_MAX_AGE = 60 * 60 * 24 * 365  # 1 year

# 노트 전용 별도 RateLimiter (reactions 와 분리, 입력 debounce 가 빈번할 수 있음).
_notes_rate_limiter: RateLimiter | None = None


def get_notes_rate_limiter() -> RateLimiter:
    global _notes_rate_limiter
    if _notes_rate_limiter is None:
        _notes_rate_limiter = RateLimiter(
            max_requests=settings.rate_limit_max_requests * 5,
            window_seconds=settings.rate_limit_window_seconds,
        )
    return _notes_rate_limiter


def _get_or_issue_session_id(request: Request, response: Response) -> str:
    """B2 동일 — anon session id 를 cookie 에서 읽거나 새로 발급 + Set-Cookie."""
    existing = request.cookies.get(ANON_SESSION_COOKIE)
    if existing and 16 <= len(existing) <= 128:
        return existing
    new_id = secrets.token_urlsafe(24)
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
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


def _to_response(note) -> CitationNoteResponse:
    return CitationNoteResponse(
        id=note.id,
        message_id=note.message_id,
        chunk_id=note.chunk_id,
        body=note.body,
        updated_at=note.updated_at,
    )


@notes_router.put(
    "/{message_id}/citation-note",
    response_model=CitationNoteResponse,
)
async def upsert_citation_note(
    message_id: uuid.UUID,
    payload: CitationNoteUpsertRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_async_session),
    rate_limiter: RateLimiter = Depends(get_notes_rate_limiter),
) -> CitationNoteResponse:
    """인용 카드 단위 노트 atomic upsert.

    - chunk_id 는 Qdrant point id (인용 카드 식별자). 빈 문자열 거부.
    - body 는 max 4000 자 (Pydantic 검증).
    - 한 (message_id, chunk_id, anon session) 당 1 개의 row 만 유지.
    """
    rate_limiter.check(_client_ip(request))

    # 빈 chunk_id 는 Pydantic min_length=1 로 1차 차단되지만, 화이트스페이스만 들어온
    # 케이스도 의미상 빈 값으로 본다.
    if not payload.chunk_id.strip():
        raise HTTPException(status_code=422, detail="chunk_id가 비어 있습니다")

    user_session_id = _get_or_issue_session_id(request, response)

    repo = ChatMessageNoteRepository(session)
    note = await repo.upsert(
        message_id=message_id,
        chunk_id=payload.chunk_id,
        user_session_id=user_session_id,
        body=payload.body,
    )
    await session.commit()
    await session.refresh(note)
    return _to_response(note)


@notes_router.get(
    "/{message_id}/citation-note",
    response_model=CitationNoteResponse | None,
)
async def get_citation_note(
    message_id: uuid.UUID,
    request: Request,
    response: Response,
    chunk_id: str = Query(..., min_length=1, max_length=CHUNK_ID_MAX_LENGTH),
    session: AsyncSession = Depends(get_async_session),
) -> CitationNoteResponse | None:
    """본인(anon session)의 노트 조회. 없으면 ``null`` 반환 (200)."""
    if not chunk_id.strip():
        raise HTTPException(status_code=422, detail="chunk_id가 비어 있습니다")

    user_session_id = _get_or_issue_session_id(request, response)

    repo = ChatMessageNoteRepository(session)
    note = await repo.get(
        message_id=message_id,
        chunk_id=chunk_id,
        user_session_id=user_session_id,
    )
    if note is None:
        return None
    return _to_response(note)


__all__ = [
    "notes_router",
    "get_notes_rate_limiter",
]
