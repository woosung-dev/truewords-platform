"""훈독 AI 질문 API (DEC-PWA-025 2차). 모두 `hoondok_token` 필수, 쓰기는 CSRF 헤더(X-Requested-With)를 요구한다.

`/hoondok/me/asks/quota` 는 `/hoondok/me/asks/{session_id}` 보다 먼저 등록해야 한다(경로 매칭 순서).
"""

import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import StreamingResponse

from app.core.common.schemas import ErrorResponse
from app.modules.hoondok.asks_schemas import AskQuota, AskRequest, MyAskDetail, MyAskListResponse, MyAskUpdate
from app.modules.hoondok.asks_service import AskService
from app.modules.hoondok.dependencies import get_ask_service, get_ask_stream_service
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User
from app.modules.safety.middleware import check_rate_limit

router = APIRouter(prefix="/hoondok", tags=["hoondok"])

_SSE_HEADERS = {
    # /chat/stream 과 같다 — Next 프록시의 gzip 버퍼링을 막아 각 SSE 이벤트를 즉시 전달한다.
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.post(
    "/ask/stream",
    response_model=None,
    dependencies=[Depends(verify_csrf), Depends(check_rate_limit)],
    responses={
        400: {"model": ErrorResponse, "description": "INPUT_BLOCKED — 빈 질문·1000자 초과·차단 패턴"},
        403: {"model": ErrorResponse, "description": "SESSION_FORBIDDEN — 내 대화가 아닌 session_id"},
        429: {"model": ErrorResponse, "description": "ASK_DAILY_LIMIT(details: limit·used·remaining·resets_at) 또는 RATE_LIMIT_EXCEEDED"},
    },
)
async def ask_stream(
    data: AskRequest,
    user: User = Depends(get_current_user),
    service: AskService = Depends(get_ask_stream_service),
) -> StreamingResponse:
    """훈독 AI 질문 SSE — 이벤트 계약은 /chat/stream 과 같다(chunk → sources → done).

    하루 횟수를 1회 쓴다(이어 묻기 포함). 답을 만들기 전에 실패하면(4xx·5xx) 횟수를 되돌린다. 401 미인증.
    """
    frames = await service.start(user.id, data)
    return StreamingResponse(frames, media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/me/asks/quota", response_model=AskQuota)
async def get_my_ask_quota(
    user: User = Depends(get_current_user),
    service: AskService = Depends(get_ask_service),
) -> AskQuota:
    """오늘(KST) 남은 질문 횟수. 401 미인증."""
    return await service.quota(user.id)


@router.get("/me/asks", response_model=MyAskListResponse)
async def list_my_asks(
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    service: AskService = Depends(get_ask_service),
) -> MyAskListResponse:
    """내 AI 질문 대화 목록(최근 답 순). 401 미인증."""
    return await service.list_mine(user.id, limit)


@router.get("/me/asks/{session_id}", response_model=MyAskDetail)
async def get_my_ask(
    session_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: AskService = Depends(get_ask_service),
) -> MyAskDetail:
    """대화 1건의 질문·답 차례. 남의 것·없는 것은 404."""
    return await service.get_mine(user.id, session_id)


@router.patch("/me/asks/{session_id}", response_model=MyAskDetail, dependencies=[Depends(verify_csrf)])
async def update_my_ask(
    session_id: uuid.UUID,
    data: MyAskUpdate,
    user: User = Depends(get_current_user),
    service: AskService = Depends(get_ask_service),
) -> MyAskDetail:
    """저장 표시 켜기·끄기. 남의 것·없는 것은 404."""
    return await service.set_saved(user.id, session_id, data.saved)


@router.delete(
    "/me/asks/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
async def delete_my_ask(
    session_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: AskService = Depends(get_ask_service),
) -> Response:
    """대화와 그 질문·답 기록 삭제. 공개 신청 복사본은 남는다(DELETE /hoondok/me/questions/{id} 로 따로 내린다). 404."""
    await service.delete_mine(user.id, session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
