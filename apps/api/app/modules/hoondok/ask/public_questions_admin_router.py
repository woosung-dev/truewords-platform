"""공개 질문 검수 admin 라우터 — /admin/hoondok/questions (DEC-PWA-025).

main.py 관리자 블록에 `_ADMIN_GATE` 로 등록한다. 상태 변경은 라우터 레벨 verify_csrf, 변경마다 log_audit.
질문·답 본문은 서버 기록 복사본이라 바꾸지 않는다 — PATCH 는 status(published|hidden)·pinned 만 받는다.
`/pins` 는 `/{question_id}` 보다 먼저 등록한다(경로 매칭 순서).
"""

from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.modules.admin.dependencies import AdminPrincipal, get_admin_service, get_current_admin, verify_csrf
from app.modules.admin.service import AdminService
from app.modules.hoondok.dependencies import get_public_question_admin_service
from app.modules.hoondok.ask.public_questions_schemas import (
    PublicQuestionAdminItem,
    PublicQuestionAdminListResponse,
    PublicQuestionPinsReorder,
    PublicQuestionPinsResponse,
    PublicQuestionReview,
    PublicQuestionStatus,
)
from app.modules.hoondok.ask.public_questions_service import PublicQuestionAdminService

public_questions_admin_router = APIRouter(
    prefix="/admin/hoondok/questions",
    tags=["admin-hoondok"],
    dependencies=[Depends(verify_csrf)],
)


@public_questions_admin_router.get("", response_model=PublicQuestionAdminListResponse)
async def list_public_questions_admin(
    status_filter: PublicQuestionStatus | None = Query(default=None, alias="status"),
    sort: Literal["oldest", "newest", "popular"] = Query(default="oldest"),
    q: str | None = Query(default=None, max_length=100, description="질문 문장 부분 일치(대소문자 무시)"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    service: PublicQuestionAdminService = Depends(get_public_question_admin_service),
    current_admin: AdminPrincipal = Depends(get_current_admin),
) -> PublicQuestionAdminListResponse:
    """검수 목록. 기본 oldest(신청 오래된 순), newest(신청 최신순), popular(인기도 → 신청 최신순). `status=pending` 이 검수 대기열이다."""
    return await service.list(status_filter, q, sort, page, page_size)


@public_questions_admin_router.get("/pins", response_model=PublicQuestionPinsResponse)
async def list_pinned_questions(
    service: PublicQuestionAdminService = Depends(get_public_question_admin_service),
    current_admin: AdminPrincipal = Depends(get_current_admin),
) -> PublicQuestionPinsResponse:
    """고정된 질문(pin_order 순, 최대 10개)."""
    return await service.list_pins()


@public_questions_admin_router.put("/pins", response_model=PublicQuestionPinsResponse)
async def reorder_pinned_questions(
    data: PublicQuestionPinsReorder,
    service: PublicQuestionAdminService = Depends(get_public_question_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: AdminPrincipal = Depends(get_current_admin),
) -> PublicQuestionPinsResponse:
    """고정 순서 바꾸기. ids 는 현재 고정 집합과 정확히 같아야 한다(중복·누락·추가는 422)."""
    return await service.reorder_pins(data, admin_service, current_admin["user_id"])


@public_questions_admin_router.patch("/{question_id}", response_model=PublicQuestionAdminItem)
async def review_public_question(
    question_id: str,
    data: PublicQuestionReview,
    service: PublicQuestionAdminService = Depends(get_public_question_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: AdminPrincipal = Depends(get_current_admin),
) -> PublicQuestionAdminItem:
    """공개(published)·숨김(hidden) 전환과 고정(pinned). 숨기면 고정이 풀린다.

    404 없음, 409 공개 중이 아닌 질문 고정·고정 10개 초과, 422 그 밖의 값·빈 본문.
    """
    return await service.review_with_audit(question_id, data, admin_service, current_admin["user_id"])
