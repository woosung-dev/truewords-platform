"""채팅 API 라우터."""

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from src.chat.dependencies import get_chat_service
from src.chat.schemas import (
    ChatRequest,
    ChatResponse,
    FeedbackRequest,
    FeedbackResponse,
    SessionHistoryResponse,
)
from src.chat.service import ChatService
from src.safety.middleware import check_rate_limit

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(check_rate_limit)])
async def chat(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
) -> ChatResponse:
    """RAG 기반 채팅 응답. 에러는 글로벌 exception_handler가 처리."""
    return await service.process_chat(request)


@router.post("/chat/stream", response_model=None, dependencies=[Depends(check_rate_limit)])
async def chat_stream(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
) -> StreamingResponse:
    """SSE 스트리밍 채팅. 에러는 글로벌 exception_handler가 처리."""
    return StreamingResponse(
        service.process_chat_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/chat/sessions/{session_id}", response_model=SessionHistoryResponse)
async def get_session_history(
    session_id: uuid.UUID,
    service: ChatService = Depends(get_chat_service),
) -> SessionHistoryResponse:
    result = await service.get_session_history(session_id)
    return SessionHistoryResponse(**result)


@router.post("/chat/feedback", response_model=FeedbackResponse, status_code=201)
async def submit_feedback(
    request: FeedbackRequest,
    service: ChatService = Depends(get_chat_service),
) -> FeedbackResponse:
    feedback = await service.submit_feedback(request)
    return FeedbackResponse(
        id=feedback.id,
        message_id=feedback.message_id,
        feedback_type=feedback.feedback_type,
        created_at=feedback.created_at,
    )
