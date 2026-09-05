"""실제 SSE 데이터 계약. 스트리밍 직렬화·오류 동작은 변경하지 않는다."""

import uuid

from pydantic import BaseModel

from app.modules.chat.schemas import FeaturedMalssum, Source


class ChatChunkEvent(BaseModel):
    text: str


class ChatSourcesEvent(BaseModel):
    sources: list[Source]
    session_id: uuid.UUID
    message_id: uuid.UUID
    closing: str | None = None
    suggested_followups: list[str] | None = None
    featured_malssum: FeaturedMalssum | None = None


class ChatDoneEvent(BaseModel):
    disclaimer: str


STREAM_EVENT_MODELS = {
    "chunk": ChatChunkEvent,
    "sources": ChatSourcesEvent,
    "done": ChatDoneEvent,
}
