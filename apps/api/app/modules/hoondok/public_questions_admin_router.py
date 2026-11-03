"""공개 질문 검수 admin 라우터 — /admin/hoondok/questions (DEC-PWA-025).

main.py 관리자 블록에 `_ADMIN_GATE` 로 등록한다. 상태 변경은 라우터 레벨 verify_csrf, 변경마다 log_audit.
질문·답 본문은 서버 기록 복사본이라 바꾸지 않는다 — PATCH 는 status(published|hidden) 만 받는다.
"""

from fastapi import APIRouter, Depends, Query

from app.modules.admin.dependencies import get_admin_service, get_current_admin, verify_csrf
from app.modules.admin.service import AdminService
from app.modules.hoondok.dependencies import get_public_question_admin_service
from app.modules.hoondok.public_questions_schemas import (
    PublicQuestionAdminItem,
    PublicQuestionAdminListResponse,
    PublicQuestionReview,
    PublicQuestionStatus,
)
from app.modules.hoondok.public_questions_service import PublicQuestionAdminService

public_questions_admin_router = APIRouter(
    prefix="/admin/hoondok/questions",
    tags=["admin-hoondok"],
    dependencies=[Depends(verify_csrf)],
)


@public_questions_admin_router.get("", response_model=PublicQuestionAdminListResponse)
async def list_public_questions_admin(
    status_filter: PublicQuestionStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    service: PublicQuestionAdminService = Depends(get_public_question_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> PublicQuestionAdminListResponse:
    """검수 목록(신청 오래된 순). `status=pending` 이 검수 대기열이다."""
    return await service.list(status_filter, page, page_size)


@public_questions_admin_router.patch("/{question_id}", response_model=PublicQuestionAdminItem)
async def review_public_question(
    question_id: str,
    data: PublicQuestionReview,
    service: PublicQuestionAdminService = Depends(get_public_question_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> PublicQuestionAdminItem:
    """공개(published)·숨김(hidden). 404 없음, 422 그 밖의 값."""
    return await service.review_with_audit(question_id, data, admin_service, current_admin["user_id"])
