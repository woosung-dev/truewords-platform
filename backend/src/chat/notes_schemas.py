"""P1-H — 인용 카드 단위 사용자 노트 Pydantic 스키마.

ADR-46 §C.3 인용 카드 3-탭(해설/본문/노트) 의 노트 영속화.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# 노트 본문 최대 길이 (모델 max 4000 과 동일).
NOTE_BODY_MAX_LENGTH = 4000
# Qdrant point id 최대 길이.
CHUNK_ID_MAX_LENGTH = 128


class CitationNoteUpsertRequest(BaseModel):
    """PUT /api/chat/messages/{message_id}/citation-note body.

    user_session_id 는 클라이언트 입력 아님 — 서버가 HttpOnly cookie 로 발급.
    """

    chunk_id: str = Field(min_length=1, max_length=CHUNK_ID_MAX_LENGTH)
    body: str = Field(max_length=NOTE_BODY_MAX_LENGTH)


class CitationNoteResponse(BaseModel):
    """노트 단건 응답 — GET / PUT 공통."""

    id: uuid.UUID
    message_id: uuid.UUID
    chunk_id: str
    body: str
    updated_at: datetime
