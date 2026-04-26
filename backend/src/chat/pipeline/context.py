"""ChatContext — Pipeline Stage 간 데이터 전달 컨텍스트."""

from __future__ import annotations

from dataclasses import dataclass, field

from src.chat.schemas import ChatRequest


@dataclass
class ChatContext:
    """R1 Phase 1: 두 Stage (InputValidation, Session) 만 사용.

    Phase 2~ 에서 query_embedding, search_results, answer 등 필드 점진 추가.
    """

    request: ChatRequest
    session: object | None = None
    user_message: object | None = None
