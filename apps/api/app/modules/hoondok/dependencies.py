"""훈독 DI 조립."""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.common.database import get_async_session
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.repository import DailyReadingRepository, JeongseongRepository, MissionLogRepository
from app.modules.hoondok.service import (
    DailyReadingAdminService,
    DailyReadingCandidateService,
    HoondokService,
    JeongseongService,
    MissionService,
)
from app.modules.qdrant import get_raw_client  # raw httpx — SDK HTTP/2 hang 회피 (docs/dev-log/47)


async def get_hoondok_repository(
    session: AsyncSession = Depends(get_async_session),
) -> DailyReadingRepository:
    return DailyReadingRepository(session)


async def get_hoondok_service(
    repo: DailyReadingRepository = Depends(get_hoondok_repository),
) -> HoondokService:
    return HoondokService(repo)


async def get_daily_reading_admin_service(
    repo: DailyReadingRepository = Depends(get_hoondok_repository),
) -> DailyReadingAdminService:
    return DailyReadingAdminService(repo)


async def get_daily_reading_candidate_service() -> DailyReadingCandidateService:
    """후보 검색은 Qdrant 만 쓴다 — DB 세션이 필요 없어 리포지토리를 받지 않는다."""
    return DailyReadingCandidateService(get_raw_client())


async def get_mission_repository(
    session: AsyncSession = Depends(get_async_session),
) -> MissionLogRepository:
    return MissionLogRepository(session)


async def get_mission_service(
    repo: MissionLogRepository = Depends(get_mission_repository),
) -> MissionService:
    return MissionService(repo)


async def get_jeongseong_repository(
    session: AsyncSession = Depends(get_async_session),
) -> JeongseongRepository:
    return JeongseongRepository(session)


async def get_jeongseong_service(
    repo: JeongseongRepository = Depends(get_jeongseong_repository),
    missions: MissionLogRepository = Depends(get_mission_repository),
) -> JeongseongService:
    # get_async_session 은 요청당 캐시되므로 두 리포는 같은 세션을 공유한다.
    return JeongseongService(repo, missions)


async def get_journey_repository(session: AsyncSession = Depends(get_async_session)) -> JourneyRepository:
    return JourneyRepository(session)


async def get_journey_service(
    repo: JourneyRepository = Depends(get_journey_repository),
    periods: JeongseongRepository = Depends(get_jeongseong_repository),
) -> JourneyService:
    return JourneyService(repo, get_raw_client(), periods)
