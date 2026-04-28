"""P1-C — 인기 질문 집계 endpoint.

ADR-46 Screen 1 §C.1.2 — 입력 화면 상단의 정적 SUGGESTED_PROMPTS 옆에
실시간 집계된 "이번 주 인기" 질문 5~10개를 노출하기 위한 공개 API.

스펙:
    GET /api/chatbot/{chatbot_id}/popular-questions?period=7d&limit=10

    - period: ``7d`` | ``30d`` | ``all`` (기본 ``7d``).
    - limit:  1~50 (기본 10).
    - chatbot_id 는 ``ChatbotConfig.chatbot_id`` (string slug).

집계 정의:
    SessionMessage.role == USER && ResearchSession.chatbot_config_id == X
    → group by content, count desc, limit N.

인증/ACL:
    - period=7d / 30d → 인증 없이 호출 가능 (rate limit 만 적용).
    - period=all      → admin 전용 (전체 기간 집계는 부하/프라이버시 고려).
    - 챗봇 단위 ACL 은 본 PR 범위 외 (ChatbotConfig 에 visibility 컬럼이 없어
      향후 W3 후속 작업에서 정책 합의 후 확장).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from src.admin.dependencies import get_current_admin
from src.chat.dependencies import get_chat_repository
from src.chat.repository import ChatRepository
from src.chatbot.dependencies import get_chatbot_service
from src.chatbot.service import ChatbotService
from src.safety.middleware import check_rate_limit

router = APIRouter(tags=["chat-popular"])

# period 슬러그 → days. None == 전체.
_PERIOD_TO_DAYS: dict[str, int | None] = {
    "7d": 7,
    "30d": 30,
    "all": None,
}

PopularPeriod = Literal["7d", "30d", "all"]


@router.get(
    "/api/chatbot/{chatbot_id}/popular-questions",
    response_model=list[dict],
    dependencies=[Depends(check_rate_limit)],
)
async def list_popular_questions(
    chatbot_id: str,
    period: PopularPeriod = Query(
        "7d", description="집계 기간 (7d | 30d | all). all 은 admin 전용."
    ),
    limit: int = Query(10, ge=1, le=50),
    chat_repo: ChatRepository = Depends(get_chat_repository),
    chatbot_service: ChatbotService = Depends(get_chatbot_service),
) -> list[dict]:
    """인기 질문 (질문 텍스트 + 횟수) 내림차순 리스트.

    Returns:
        ``[{"question": str, "count": int}, ...]`` — 길이는 최대 ``limit``.

    Raises:
        HTTPException 400 — 잘못된 period.
        HTTPException 401 — period=all 인데 admin 인증 미통과.
        HTTPException 404 — 존재하지 않는 chatbot_id.
    """
    if period not in _PERIOD_TO_DAYS:
        raise HTTPException(status_code=400, detail="알 수 없는 period")

    period_days = _PERIOD_TO_DAYS[period]

    # period=all 만 admin 인증 필요. fastapi Depends 로 분기하기 어렵기 때문에
    # 핸들러 안에서 명시적으로 호출 (인증 실패 시 HTTPException 401).
    if period_days is None:
        # admin dependency 는 Request 인자가 필요하므로 직접 호출 대신
        # _admin_only 헬퍼로 검증.
        await _require_admin()

    config_id = await chatbot_service.get_config_id(chatbot_id)
    if config_id is None:
        raise HTTPException(status_code=404, detail="챗봇을 찾을 수 없습니다")

    rows = await chat_repo.get_popular_questions(
        config_id,
        period_days=period_days,
        limit=limit,
    )
    return [{"question": q, "count": c} for q, c in rows]


# period=all 만 별도로 admin 인증을 요구한다. FastAPI 의 Depends 는 dependency
# 함수가 다른 Depends 를 자동 해석하기 때문에, 라우터 정의 단계에서 동적으로
# admin 분기를 하려면 별도 sub-dependency 를 가진 핸들러가 필요하다. 본 PR 은
# 단일 endpoint 에서 분기를 처리하기 위해 admin endpoint 를 구성하지 않고,
# request scope 에서 직접 검증한다.
async def _require_admin() -> None:
    """period=all 호출 시 admin 인증 강제 — 실패 시 401."""
    # NOTE: 별도 admin 토큰 검증 endpoint 가 있는 곳에서는 cookie 기반으로
    #   동작하므로 dependency 호출이 필요. 여기서는 별도 endpoint 를 제공하지
    #   않고, /admin/popular-questions/all 같은 admin 전용 alias 가 도입되기
    #   전까지는 401 로 차단한다 (기본 가벼움 정책: 비인증 = 7d/30d 만).
    raise HTTPException(
        status_code=401,
        detail=(
            "period=all 은 admin 전용입니다. /admin 인증 후 admin endpoint 를"
            " 사용하세요."
        ),
    )


# --- Admin 전용 alias (period=all 에서 분리된 endpoint) ---
admin_popular_router = APIRouter(
    prefix="/admin/chatbot",
    tags=["admin-chat-popular"],
)


@admin_popular_router.get(
    "/{chatbot_id}/popular-questions",
    response_model=list[dict],
)
async def list_popular_questions_admin(
    chatbot_id: str,
    period: PopularPeriod = Query("all"),
    limit: int = Query(20, ge=1, le=100),
    chat_repo: ChatRepository = Depends(get_chat_repository),
    chatbot_service: ChatbotService = Depends(get_chatbot_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[dict]:
    """관리자용 인기 질문 — period=all 포함, limit 상한 100."""
    if period not in _PERIOD_TO_DAYS:
        raise HTTPException(status_code=400, detail="알 수 없는 period")

    period_days = _PERIOD_TO_DAYS[period]
    config_id = await chatbot_service.get_config_id(chatbot_id)
    if config_id is None:
        raise HTTPException(status_code=404, detail="챗봇을 찾을 수 없습니다")

    rows = await chat_repo.get_popular_questions(
        config_id,
        period_days=period_days,
        limit=limit,
    )
    return [{"question": q, "count": c} for q, c in rows]


__all__ = ["router", "admin_popular_router"]
