"""P1-K — 운영자 검수 (AnswerReview) API 라우터.

Endpoint:
    GET  /admin/answer-reviews/queue   — 미검수 메시지 큐
    POST /admin/answer-reviews         — 검수 라벨 생성
    GET  /admin/answer-reviews/stats   — 라벨별 카운트 + 적합/부적합 비율

ADR-46 P1-K. AnswerFeedback (사용자/혼합 자유서술) 와 별도 컬렉션.
About 페이지 stats wire-up 은 후속 PR.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.answer_review_repository import AnswerReviewRepository
from src.admin.answer_review_schemas import (
    AnswerReviewCreate,
    AnswerReviewResponse,
    ReviewQueueResponse,
    ReviewStatsResponse,
)
from src.admin.answer_review_service import AnswerReviewService
from src.admin.dependencies import get_current_admin, verify_csrf
from src.common.database import get_async_session

router = APIRouter(prefix="/admin/answer-reviews", tags=["answer-reviews"])


def _get_repo(
    session: AsyncSession = Depends(get_async_session),
) -> AnswerReviewRepository:
    return AnswerReviewRepository(session)


def _get_service(
    repo: AnswerReviewRepository = Depends(_get_repo),
) -> AnswerReviewService:
    return AnswerReviewService(repo)


@router.get("/queue", response_model=ReviewQueueResponse)
async def get_queue(
    chatbot_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    service: AnswerReviewService = Depends(_get_service),
    current_admin: dict = Depends(get_current_admin),
) -> ReviewQueueResponse:
    """미검수 메시지 큐.

    - 부정 피드백을 받은 메시지를 우선, 그 다음 최신순.
    - 이미 검수 라벨이 부여된 메시지는 제외.
    """
    return await service.get_queue(chatbot_id=chatbot_id, limit=limit)


@router.post(
    "",
    response_model=AnswerReviewResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def create_review(
    payload: AnswerReviewCreate,
    service: AnswerReviewService = Depends(_get_service),
    current_admin: dict = Depends(get_current_admin),
) -> AnswerReviewResponse:
    """검수 라벨 생성.

    유효 라벨: approved / theological_error / citation_error / tone_error /
    off_domain — Pydantic Literal 검증으로 알 수 없는 값은 422.
    """
    try:
        return await service.create_review(
            message_id=payload.message_id,
            reviewer_user_id=current_admin["user_id"],
            label=payload.label,
            notes=payload.notes,
        )
    except ValueError as exc:
        # 이론상 도달 불가 (Pydantic Literal 통과). 방어용.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"알 수 없는 라벨: {exc}",
        ) from exc


@router.get("/stats", response_model=ReviewStatsResponse)
async def get_stats(
    period: str = Query(default="7d", pattern="^[0-9]+d$"),
    service: AnswerReviewService = Depends(_get_service),
    current_admin: dict = Depends(get_current_admin),
) -> ReviewStatsResponse:
    """라벨별 카운트 + 적합/부적합 비율.

    period 파라미터: '7d', '30d' 처럼 'Nd' 형식. 정수 일수만 지원.
    About 페이지의 placeholder 통계를 대체할 실데이터 소스.
    """
    days = int(period.rstrip("d"))
    if days < 1 or days > 365:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="period 는 1d~365d 범위여야 합니다",
        )
    return await service.get_stats(period_days=days)
