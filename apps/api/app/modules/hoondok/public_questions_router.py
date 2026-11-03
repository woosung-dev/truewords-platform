"""공개 질문 API (DEC-PWA-025).

`/hoondok/questions*` 는 공개(published 만, 인증 없음), `/hoondok/me/questions*` 는 `hoondok_token` 이며 쓰기는 CSRF 헤더를 요구한다.
응답에 작성자 정보(user_id·이메일·이름)를 넣지 않는다.
"""

from fastapi import APIRouter, Depends, Query, Response, status

from app.modules.hoondok.dependencies import get_public_question_service
from app.modules.hoondok.public_questions_schemas import (
    MyPublicQuestionItem,
    MyPublicQuestionListResponse,
    PublicQuestionCreate,
    PublicQuestionDetail,
    PublicQuestionListResponse,
)
from app.modules.hoondok.public_questions_service import PublicQuestionService
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User

router = APIRouter(prefix="/hoondok", tags=["hoondok"])


@router.get("/questions", response_model=PublicQuestionListResponse)
async def list_public_questions(
    q: str | None = Query(default=None, max_length=100, description="질문 문장 부분 일치(대소문자 무시)"),
    cursor: str | None = Query(default=None, max_length=32, description="직전 응답의 next_cursor"),
    limit: int = Query(default=20, ge=1, le=50),
    service: PublicQuestionService = Depends(get_public_question_service),
) -> PublicQuestionListResponse:
    """검수를 거쳐 공개된 질문 목록(최신 공개순). 인증 없음. 422 잘못된 cursor."""
    return await service.list_public(q, cursor, limit)


@router.get("/questions/{question_id}", response_model=PublicQuestionDetail)
async def get_public_question(
    question_id: str,
    service: PublicQuestionService = Depends(get_public_question_service),
) -> PublicQuestionDetail:
    """공개 질문 1건. published 가 아니면(검토 중·숨김·없음) 404."""
    return await service.get_public(question_id)


@router.post(
    "/me/questions",
    response_model=MyPublicQuestionItem,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def submit_public_question(
    data: PublicQuestionCreate,
    user: User = Depends(get_current_user),
    service: PublicQuestionService = Depends(get_public_question_service),
) -> MyPublicQuestionItem:
    """공개 신청 → status=pending. 본인 재신청은 기존 신청을 돌려준다.

    404 답 없음 또는 내 계정 대화의 답이 아님, 409 공개할 수 없는 답(마음 돌봄·위기·근거 없음·이어 물은 답),
    401 미인증, 403 CSRF.
    """
    return await service.submit(user.id, data.message_id)


@router.get("/me/questions", response_model=MyPublicQuestionListResponse)
async def list_my_public_questions(
    user: User = Depends(get_current_user),
    service: PublicQuestionService = Depends(get_public_question_service),
) -> MyPublicQuestionListResponse:
    """내 공개 신청과 상태(최근 신청순). 401 미인증."""
    return await service.list_mine(user.id)


@router.delete(
    "/me/questions/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
async def delete_my_public_question(
    question_id: str,
    user: User = Depends(get_current_user),
    service: PublicQuestionService = Depends(get_public_question_service),
) -> Response:
    """내 신청 삭제 — 바로 비노출되고 되살릴 수 없다. 남의 것·없는 것은 404."""
    await service.delete_mine(user.id, question_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
