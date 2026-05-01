"""분석 대시보드 API 라우터."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.analytics_repository import AnalyticsRepository
from src.admin.analytics_schemas import (
    DailyCount,
    DashboardSummary,
    FeedbackSummary,
    FeedbackDistribution,
    NegativeFeedbackItem,
    QueryDetailResponse,
    QueryListResponse,
    SearchStats,
    TopQuery,
)
from src.admin.dependencies import get_current_admin
from src.common.database import get_async_session
from src.config import settings
from src.qdrant_client import get_raw_client

router = APIRouter(prefix="/admin/analytics", tags=["analytics"])


def _get_repo(session: AsyncSession = Depends(get_async_session)) -> AnalyticsRepository:
    return AnalyticsRepository(session)


@router.get("/dashboard-summary", response_model=DashboardSummary)
async def get_dashboard_summary(
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> DashboardSummary:
    """대시보드 홈 요약 메트릭."""
    questions = await repo.get_question_counts()
    feedback = await repo.get_feedback_counts()

    # Qdrant 포인트 수
    try:
        qdrant_count = await get_raw_client().count(settings.collection_name)
    except Exception:
        qdrant_count = 0

    return DashboardSummary(
        today_questions=questions["today"],
        week_questions=questions["week"],
        total_qdrant_points=qdrant_count,
        feedback_helpful=feedback["helpful"],
        feedback_negative=feedback["negative"],
    )


@router.get("/search/daily-trend", response_model=list[DailyCount])
async def get_daily_trend(
    days: int = Query(default=30, ge=1, le=365),
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> list[DailyCount]:
    """일별 질문 수 트렌드."""
    rows = await repo.get_daily_trend(days)
    return [DailyCount(**r) for r in rows]


@router.get("/search/stats", response_model=SearchStats)
async def get_search_stats(
    days: int = Query(default=30, ge=1, le=365),
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> SearchStats:
    """검색 통계 집계."""
    stats = await repo.get_search_stats(days)
    return SearchStats(**stats)


@router.get("/search/top-queries", response_model=list[TopQuery])
async def get_top_queries(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=10, ge=1, le=50),
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> list[TopQuery]:
    """인기 질문 Top N."""
    rows = await repo.get_top_queries(days, limit)
    return [TopQuery(**r) for r in rows]


@router.get("/feedback/summary", response_model=FeedbackSummary)
async def get_feedback_summary(
    days: int = Query(default=30, ge=1, le=365),
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> FeedbackSummary:
    """피드백 유형 분포."""
    rows = await repo.get_feedback_distribution(days)
    return FeedbackSummary(
        distribution=[FeedbackDistribution(**r) for r in rows],
    )


@router.get("/feedback/negative", response_model=list[NegativeFeedbackItem])
async def get_negative_feedback(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> list[NegativeFeedbackItem]:
    """부정 피드백 목록."""
    rows = await repo.get_negative_feedback(limit, offset)
    return [NegativeFeedbackItem(**r) for r in rows]


@router.get("/search/query-details", response_model=QueryDetailResponse)
async def get_query_details(
    query_text: str = Query(..., min_length=1, max_length=1000),
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=100),
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> QueryDetailResponse:
    """인기 질문의 모든 발생 상세 조회."""
    data = await repo.get_query_details(query_text, days, limit)
    return QueryDetailResponse(**data)


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
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> QueryListResponse:
    """고유 질문 집계 + 검색/정렬/페이지네이션."""
    data = await repo.get_queries(q=q, days=days, sort=sort, page=page, size=size)
    return QueryListResponse(**data)
