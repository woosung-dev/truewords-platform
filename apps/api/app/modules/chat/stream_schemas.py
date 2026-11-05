"""실제 SSE 데이터 계약. 스트리밍 직렬화·오류 동작은 변경하지 않는다."""

import uuid

from pydantic import BaseModel

from app.modules.chat.schemas import FeaturedMalssum, Source
from app.modules.chat.types import AnswerMode


class ChatChunkEvent(BaseModel):
    text: str


class ChatSourcesEvent(BaseModel):
    sources: list[Source]
    session_id: uuid.UUID
    message_id: uuid.UUID
    closing: str | None = None
    suggested_followups: list[str] | None = None
    featured_malssum: FeaturedMalssum | None = None
    # 실제 적용된 답변 모드(resolve_answer_mode 결과). 요청 모드와 다를 수 있다(위기 신호 → pastoral).
    answer_mode: AnswerMode


class ChatDoneEvent(BaseModel):
    disclaimer: str


STREAM_EVENT_MODELS = {
    "chunk": ChatChunkEvent,
    "sources": ChatSourcesEvent,
    "done": ChatDoneEvent,
}
