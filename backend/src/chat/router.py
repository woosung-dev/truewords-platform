"""채팅 API 라우터."""

import uuid

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse, StreamingResponse

from src.chat.dependencies import get_chat_service
from src.chat.schemas import (
    ChatRequest,
    ChatResponse,
    FeedbackRequest,
    FeedbackResponse,
    SessionHistoryResponse,
)
from src.chat.service import ChatService
from src.safety.exceptions import InputBlockedError, RateLimitExceededError
from src.safety.middleware import check_rate_limit

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(check_rate_limit)])
async def chat(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
) -> Response:
    try:
        return await service.process_chat(request)
    except InputBlockedError as e:
        return JSONResponse(status_code=400, content={"detail": e.reason})
    except RateLimitExceededError as e:
        return JSONResponse(
            status_code=429,
            content={"detail": str(e)},
            headers={"Retry-After": str(e.retry_after)},
        )


@router.post("/chat/stream", response_model=None, dependencies=[Depends(check_rate_limit)])
async def chat_stream(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
) -> Response:
    try:
        return StreamingResponse(
            service.process_chat_stream(request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except InputBlockedError as e:
        return JSONResponse(status_code=400, content={"detail": e.reason})
    except RateLimitExceededError as e:
        return JSONResponse(
            status_code=429,
            content={"detail": str(e)},
            headers={"Retry-After": str(e.retry_after)},
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
