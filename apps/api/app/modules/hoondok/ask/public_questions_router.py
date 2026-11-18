"""공개 질문 API (DEC-PWA-025).

`/hoondok/questions*` 목록·상세는 공개(published 만, 인증 없음 — 로그인했으면 bookmarked 를 채운다), 조회 기록은 익명도 가능하다.
`/hoondok/me/questions*`·북마크는 `hoondok_token` 이며 쓰기는 CSRF 헤더를 요구한다.
응답에 작성자 정보(user_id·이메일·이름)를 넣지 않는다.
"""

from fastapi import APIRouter, Depends, Query, Response, status

from app.modules.hoondok.dependencies import get_public_question_service
from app.modules.hoondok.ask.public_questions_schemas import (
    MyPublicQuestionItem,
    MyPublicQuestionListResponse,
    PublicQuestionBookmarkListResponse,
    PublicQuestionCreate,
    PublicQuestionDetail,
    PublicQuestionListResponse,
    PublicQuestionViewCreate,
)
from app.modules.hoondok.ask.public_questions_service import PublicQuestionService
from app.modules.identity.dependencies import get_current_user, get_optional_user, verify_csrf
from app.modules.identity.models import User
from app.modules.safety.middleware import check_rate_limit

router = APIRouter(prefix="/hoondok", tags=["hoondok"])


@router.get("/questions", response_model=PublicQuestionListResponse)
async def list_public_questions(
    q: str | None = Query(default=None, max_length=100, description="질문 문장 부분 일치(대소문자 무시)"),
    cursor: str | None = Query(default=None, max_length=32, description="직전 응답의 next_cursor"),
    limit: int = Query(default=20, ge=1, le=50),
    service: PublicQuestionService = Depends(get_public_question_service),
    user: User | None = Depends(get_optional_user),
) -> PublicQuestionListResponse:
    """검수를 거쳐 공개된 질문 목록 — 고정 질문 → 인기순(조회 수 + 3 × 질문 수) → 최근 공개순. 인증 없음.

    cursor 는 불투명 문자열이다. 숫자 offset 이 아닌 값(예전 질문 id 포함)은 422.
    로그인했으면 항목의 bookmarked 를 채운다(익명은 false).
    """
    return await service.list_public(q, cursor, limit, user.id if user else None)


@router.get("/questions/{question_id}", response_model=PublicQuestionDetail)
async def get_public_question(
    question_id: str,
    service: PublicQuestionService = Depends(get_public_question_service),
    user: User | None = Depends(get_optional_user),
) -> PublicQuestionDetail:
    """공개 질문 1건. published 가 아니면(검토 중·숨김·없음) 404. 로그인했으면 bookmarked 를 채운다."""
    return await service.get_public(question_id, user.id if user else None)


@router.post(
    "/questions/{question_id}/views",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf), Depends(check_rate_limit)],
)
async def record_public_question_view(
    question_id: str,
    data: PublicQuestionViewCreate,
    service: PublicQuestionService = Depends(get_public_question_service),
    user: User | None = Depends(get_optional_user),
) -> Response:
    """조회 1회 기록 — (질문, 조회자, KST 날짜)당 한 번만 센다. 로그인 계정이 우선, 익명은 viewer_id(기기 UUID).

    계정도 viewer_id 도 없으면 세지 않고 204. published 가 아니면 404, 403 CSRF, 429 요청 한도.
    """
    await service.record_view(question_id, user.id if user else None, data.viewer_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/questions/{question_id}/bookmark",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
async def put_public_question_bookmark(
    question_id: str,
    user: User = Depends(get_current_user),
    service: PublicQuestionService = Depends(get_public_question_service),
) -> Response:
    """추천 질문 담기(멱등). published 가 아니면 404, 401 미인증, 403 CSRF."""
    await service.put_bookmark(user.id, question_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/questions/{question_id}/bookmark",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
async def delete_public_question_bookmark(
    question_id: str,
    user: User = Depends(get_current_user),
    service: PublicQuestionService = Depends(get_public_question_service),
) -> Response:
    """담기 해제(멱등). 공개가 내려갔거나 없는 질문이어도 204 — 남은 북마크를 지울 수 있다."""
    await service.delete_bookmark(user.id, question_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/question-bookmarks", response_model=PublicQuestionBookmarkListResponse)
async def list_my_question_bookmarks(
    limit: int = Query(default=100, ge=1, le=100),
    user: User = Depends(get_current_user),
    service: PublicQuestionService = Depends(get_public_question_service),
) -> PublicQuestionBookmarkListResponse:
    """내가 담은 추천 질문 — 아직 공개 중인 것만, 최근에 담은 순. 401 미인증."""
    return await service.list_bookmarks(user.id, limit)


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
