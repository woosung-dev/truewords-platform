"""권리 기반 서고·검색·원문·정성 API."""

from fastapi import APIRouter, Depends, Query, Request

from app.modules.hoondok.dependencies import get_journey_service
from app.modules.hoondok.journey_schemas import (
    JeongseongTodayResponse,
    LibraryResponse,
    WordSearchResponse,
    WordsResponse,
)
from app.modules.hoondok.journey_service import JourneyService
from app.modules.identity.dependencies import get_current_user
from app.modules.identity.models import User
from app.modules.safety.middleware import check_rate_limit, extract_client_ip
from app.modules.safety.rate_limiter import RateLimiter

router = APIRouter(prefix="/hoondok", tags=["hoondok"])

# 원문은 권리 승인 저작물이라 volume·page 순회 수집을 막아야 한다. 다만 구간을 넘길 때마다
# 호출되는 읽기 경로라 chat 과 같은 예산(20/분)을 쓰면 정상 독자가 먼저 막힌다 — 별도 예산을 둔다.
words_limiter = RateLimiter(max_requests=120, window_seconds=60)


async def check_words_limit(request: Request) -> None:
    words_limiter.check(extract_client_ip(request))


@router.get("/library", response_model=LibraryResponse)
async def get_library(
    service: JourneyService = Depends(get_journey_service),
) -> LibraryResponse:
    return await service.library()


@router.get(
    "/search",
    response_model=WordSearchResponse,
    dependencies=[Depends(check_rate_limit)],
)
async def search_words(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
    service: JourneyService = Depends(get_journey_service),
) -> WordSearchResponse:
    return await service.search(q, limit)


@router.get(
    "/words/{volume:path}",
    response_model=WordsResponse,
    dependencies=[Depends(check_words_limit)],
)
async def get_words(
    volume: str,
    page: int = Query(default=1, ge=1),
    chunk_id: str | None = Query(default=None, max_length=128),
    service: JourneyService = Depends(get_journey_service),
) -> WordsResponse:
    return await service.words(volume, page, chunk_id)


@router.get("/me/jeongseong/today", response_model=JeongseongTodayResponse)
async def get_jeongseong_today(
    user: User = Depends(get_current_user),
    service: JourneyService = Depends(get_journey_service),
) -> JeongseongTodayResponse:
    return await service.today(user.id)
