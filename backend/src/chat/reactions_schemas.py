"""P1-A — 답변 반응 (👍/👎/💾) Pydantic 스키마.

ADR-46 §C.3 답변 평가 영역. AnswerFeedback (운영자 라벨링용) 과 분리.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# 클라이언트와 1-1 매칭되는 Literal — DB enum 과 동일 값.
ReactionKind = Literal["thumbs_up", "thumbs_down", "save"]


class ReactionRequest(BaseModel):
    """POST /api/chat/messages/{id}/reaction body."""

    kind: ReactionKind
    # 비로그인 사용자도 토글 가능 — 클라이언트가 자체 fingerprint/cookie 로 발급.
    user_session_id: str = Field(min_length=1, max_length=128)


class ReactionResponse(BaseModel):
    """단일 반응 응답."""

    id: uuid.UUID
    message_id: uuid.UUID
    user_session_id: str
    kind: ReactionKind
    created_at: datetime


class ReactionToggleResponse(BaseModel):
    """토글 결과 — added 면 reaction 포함, removed 면 없음."""

    action: Literal["added", "removed"]
    reaction: ReactionResponse | None = None


class ReactionAggregate(BaseModel):
    """단일 message_id 의 반응 카운트 집계 — UI badge 용."""

    message_id: uuid.UUID
    thumbs_up: int = 0
    thumbs_down: int = 0
    save: int = 0
