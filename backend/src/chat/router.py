"""채팅 API 라우터."""

import uuid

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import StreamingResponse

from src.chat.anon_session import get_or_issue_session_id
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
    http_request: Request,
    http_response: Response,
    service: ChatService = Depends(get_chat_service),
) -> FeedbackResponse:
    """답변 피드백 upsert — 익명 세션(tw_anon_session 쿠키)별 메시지당 1행.

    같은 세션이 같은 메시지에 재제출하면 교체(UPDATE), 좋아요↔싫어요 전환도 교체.
    취소는 DELETE /chat/feedback/{message_id} 로 처리한다.
    """
    user_session_id = get_or_issue_session_id(http_request, http_response)
    action, feedback = await service.upsert_feedback(request, user_session_id)
    return FeedbackResponse(
        id=feedback.id,
        message_id=feedback.message_id,
        feedback_type=feedback.feedback_type,
        created_at=feedback.created_at,
        action=action,  # type: ignore[arg-type]
    )


@router.delete("/chat/feedback/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feedback(
    message_id: uuid.UUID,
    http_request: Request,
    http_response: Response,
    service: ChatService = Depends(get_chat_service),
) -> Response:
    """답변 피드백 취소 — 현재 세션의 해당 메시지 피드백 삭제. 없어도 멱등 204."""
    user_session_id = get_or_issue_session_id(http_request, http_response)
    await service.delete_feedback(message_id, user_session_id)
    # get_or_issue_session_id 가 Set-Cookie 를 걸 수 있으므로 동일 response 반환.
    http_response.status_code = status.HTTP_204_NO_CONTENT
    return http_response
