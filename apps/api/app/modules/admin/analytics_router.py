"""분석 대시보드 API 라우터.

audit P0-6 fix (2026-05-15): 룰 §3 "Router → Service → Repository" + "Dependencies
조립의 유일한 위치" 정합. 기존 `_get_repo` 내부 헬퍼 제거하고 모든 endpoint 가
`AnalyticsService` 를 통해 호출하도록 변경. Repository 조립은 `admin/dependencies.py`.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.admin.analytics_schemas import (
    DailyCount,
    DailyModeCount,
    DashboardSummary,
    FeedbackSummary,
    FeedbackDistribution,
    NegativeFeedbackItem,
    QueryDetailResponse,
    QueryListResponse,
    SearchStats,
    SessionDetailResponse,
    TopQuery,
)
from app.modules.admin.analytics_service import AnalyticsService
from app.modules.admin.dependencies import get_analytics_service, get_current_admin

router = APIRouter(prefix="/admin/analytics", tags=["analytics"])


@router.get("/dashboard-summary", response_model=DashboardSummary)
async def get_dashboard_summary(
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> DashboardSummary:
    """대시보드 홈 요약 메트릭."""
    return DashboardSummary(**await service.get_dashboard_summary())


@router.get("/search/daily-trend", response_model=list[DailyCount])
async def get_daily_trend(
    days: int = Query(default=30, ge=1, le=365),
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[DailyCount]:
    """일별 질문 수 트렌드."""
    rows = await service.get_daily_trend(days)
    return [DailyCount(**r) for r in rows]


@router.get("/modes/daily", response_model=list[DailyModeCount])
async def get_daily_modes(
    days: int = Query(default=30, ge=1, le=365),
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[DailyModeCount]:
    """일별 resolved_answer_mode 분포 (BL-6 — 4주 시범 운영 baseline)."""
    rows = await service.get_daily_modes(days)
    return [DailyModeCount(**r) for r in rows]


@router.get("/search/stats", response_model=SearchStats)
async def get_search_stats(
    days: int = Query(default=30, ge=1, le=365),
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> SearchStats:
    """검색 통계 집계."""
    return SearchStats(**await service.get_search_stats(days))


@router.get("/search/top-queries", response_model=list[TopQuery])
async def get_top_queries(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=10, ge=1, le=50),
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[TopQuery]:
    """인기 질문 Top N."""
    rows = await service.get_top_queries(days, limit)
    return [TopQuery(**r) for r in rows]


@router.get("/feedback/summary", response_model=FeedbackSummary)
async def get_feedback_summary(
    days: int = Query(default=30, ge=0, le=365),  # 0 = 전체 기간
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> FeedbackSummary:
    """피드백 유형 분포. days=0 이면 전체 기간."""
    rows = await service.get_feedback_distribution(days)
    return FeedbackSummary(
        distribution=[FeedbackDistribution(**r) for r in rows],
    )


@router.get("/feedback/negative", response_model=list[NegativeFeedbackItem])
async def get_negative_feedback(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[NegativeFeedbackItem]:
    """부정 피드백 목록 (backward compat — /feedback/list?polarity=negative 와 동일)."""
    rows = await service.get_feedback_list("negative", limit, offset)
    return [NegativeFeedbackItem(**r) for r in rows]


@router.get("/feedback/list", response_model=list[NegativeFeedbackItem])
async def get_feedback_list(
    polarity: str = Query(default="negative", pattern="^(positive|negative)$"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    days: int = Query(default=0, ge=0, le=365),  # 0 = 전체 기간
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[NegativeFeedbackItem]:
    """피드백 목록 (긍정/부정) — polarity + 기간(days) 으로 필터링."""
    rows = await service.get_feedback_list(polarity, limit, offset, days)
    return [NegativeFeedbackItem(**r) for r in rows]


@router.get("/search/query-details", response_model=QueryDetailResponse)
async def get_query_details(
    query_text: str = Query(..., min_length=1, max_length=1000),
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=100),
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> QueryDetailResponse:
    """인기 질문의 모든 발생 상세 조회."""
    data = await service.get_query_details(query_text, days, limit)
    return QueryDetailResponse(**data)


@router.get("/sessions/{session_id}", response_model=SessionDetailResponse)
async def get_session_detail(
    session_id: UUID,
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> SessionDetailResponse:
    """세션 전체 메시지 + 반응/피드백/출처 inline (시간순).

    피드백 row 에서 어떤 대화 맥락이었는지 추적하기 위한 진입점.
    """
    data = await service.get_session_detail(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="session not found")
    return SessionDetailResponse(**data)


@router.get("/search/queries", response_model=QueryListResponse)
async def get_queries(
    q: str = Query(default="", max_length=500),
    days: int = Query(default=30, ge=1, le=365),
    sort: str = Query(
        default="count_desc",
        pattern="^(count_desc|count_asc|recent_desc|recent_asc)$",
    ),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=100),
    service: AnalyticsService = Depends(get_analytics_service),
    current_admin: dict = Depends(get_current_admin),
) -> QueryListResponse:
    """고유 질문 집계 + 검색/정렬/페이지네이션."""
    data = await service.get_queries(q=q, days=days, sort=sort, page=page, size=size)
    return QueryListResponse(**data)
