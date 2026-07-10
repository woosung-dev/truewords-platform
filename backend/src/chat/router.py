"""채팅 API 라우터."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from src.chat.anon_session import get_or_issue_session_id
from src.chat.dependencies import (
    get_chat_service,
    get_current_admin,
    get_optional_user_id,
)
from src.chat.schemas import (
    ChatRequest,
    ChatResponse,
    FeedbackRequest,
    FeedbackResponse,
    SessionHistoryResponse,
    SessionListResponse,
)
from src.chat.service import ChatService
from src.safety.middleware import check_rate_limit

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(check_rate_limit)])
async def chat(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
    user_id: uuid.UUID | None = Depends(get_optional_user_id),
) -> ChatResponse:
    """RAG 기반 채팅 응답. 에러는 글로벌 exception_handler가 처리.

    로그인 상태면 세션을 사용자에게 귀속(user_id) → 대화 기록 목록 조회 대상.
    """
    return await service.process_chat(request, user_id)


@router.post("/chat/stream", response_model=None, dependencies=[Depends(check_rate_limit)])
async def chat_stream(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
    user_id: uuid.UUID | None = Depends(get_optional_user_id),
) -> StreamingResponse:
    """SSE 스트리밍 채팅. 에러는 글로벌 exception_handler가 처리."""
    return StreamingResponse(
        service.process_chat_stream(request, user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/chat/sessions", response_model=SessionListResponse)
async def list_my_sessions(
    limit: int = 100,
    offset: int = 0,
    current_admin: dict = Depends(get_current_admin),
    service: ChatService = Depends(get_chat_service),
) -> SessionListResponse:
    """내 대화 세션 목록 (최근 활동순). 로그인 필수 — 본인 세션만."""
    result = await service.list_user_sessions(
        current_admin["user_id"], min(limit, 200), max(offset, 0)
    )
    return SessionListResponse(**result)


@router.get("/chat/sessions/{session_id}", response_model=SessionHistoryResponse)
async def get_session_history(
    session_id: uuid.UUID,
    current_admin: dict = Depends(get_current_admin),
    service: ChatService = Depends(get_chat_service),
) -> SessionHistoryResponse:
    """단일 세션 대화 이력. 로그인 필수 + 소유권 검증 (본인 세션만)."""
    result = await service.get_session_history(session_id, current_admin["user_id"])
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="세션을 찾을 수 없습니다")
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
