"""채팅 API 라우터."""

import uuid

from fastapi import APIRouter, Depends

from src.chat.dependencies import get_chat_service
from src.chat.schemas import (
    ChatRequest,
    ChatResponse,
    FeedbackRequest,
    FeedbackResponse,
    SessionHistoryResponse,
)
from src.chat.service import ChatService

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
) -> ChatResponse:
    return await service.process_chat(request)


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
