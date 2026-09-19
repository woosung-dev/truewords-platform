"""훈독 DI 조립."""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.common.database import get_async_session
from app.modules.hoondok.repository import DailyReadingRepository, JeongseongRepository, MissionLogRepository
from app.modules.hoondok.service import DailyReadingAdminService, HoondokService, JeongseongService, MissionService


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
