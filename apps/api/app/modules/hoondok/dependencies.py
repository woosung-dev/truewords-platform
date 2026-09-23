"""훈독 DI 조립."""

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.common.database import get_async_session
from app.core.config import settings
from app.modules.hoondok.groups_repository import GroupRepository
from app.modules.hoondok.groups_service import GroupAdminService, GroupInviteVerifier, GroupService
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.library_repository import LibraryRepository
from app.modules.hoondok.library_service import LibraryService
from app.modules.hoondok.notifications_repository import NotificationRepository
from app.modules.hoondok.notifications_service import NotificationService
from app.modules.hoondok.repository import DailyReadingRepository, JeongseongRepository, MissionLogRepository
from app.modules.hoondok.service import (
    DailyReadingAdminService,
    DailyReadingCandidateService,
    HoondokService,
    JeongseongService,
    MissionService,
)
from app.modules.hoondok.together_service import TogetherService
from app.modules.qdrant import get_raw_client  # raw httpx — SDK HTTP/2 hang 회피 (docs/dev-log/47)
from app.modules.safety.middleware import extract_client_ip
from app.modules.safety.rate_limiter import RateLimiter

# 초대 코드 추측 방어 (PLAN-HD-010 §5): API-HD-035·036 과 가입(API-HD-002)의 모임 코드 검증이 공유한다.
# [가정] 인메모리·단일 워커 전제 — RateLimiter 주석 참고.
invite_limiter = RateLimiter(max_requests=10, window_seconds=60)


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


async def get_together_service(
    repo: MissionLogRepository = Depends(get_mission_repository),
) -> TogetherService:
    return TogetherService(
        repo,
        min_count=settings.hoondok_together_min_count,
        cache_seconds=settings.hoondok_together_cache_seconds,
    )


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


async def get_library_repository(
    session: AsyncSession = Depends(get_async_session),
) -> LibraryRepository:
    return LibraryRepository(session)


async def get_library_service(
    repo: LibraryRepository = Depends(get_library_repository),
) -> LibraryService:
    return LibraryService(repo)


async def get_journey_service(
    repo: JourneyRepository = Depends(get_journey_repository),
    periods: JeongseongRepository = Depends(get_jeongseong_repository),
    library: LibraryRepository = Depends(get_library_repository),
) -> JourneyService:
    # 장 목차(ENT-HD-010)는 서고 리포가 읽는다 — API-HD-016 의 section 동봉에 필요하다.
    return JourneyService(repo, get_raw_client(), periods, library=library)


async def get_notification_repository(
    session: AsyncSession = Depends(get_async_session),
) -> NotificationRepository:
    return NotificationRepository(session)


async def get_notification_service(
    repo: NotificationRepository = Depends(get_notification_repository),
) -> NotificationService:
    return NotificationService(repo)


async def check_invite_limit(request: Request) -> None:
    invite_limiter.check(extract_client_ip(request))


async def get_group_repository(session: AsyncSession = Depends(get_async_session)) -> GroupRepository:
    return GroupRepository(session)


async def get_group_service(repo: GroupRepository = Depends(get_group_repository)) -> GroupService:
    return GroupService(repo)


async def get_group_admin_service(repo: GroupRepository = Depends(get_group_repository)) -> GroupAdminService:
    return GroupAdminService(repo)


async def get_group_invite_verifier(
    request: Request,
    service: GroupService = Depends(get_group_service),
) -> GroupInviteVerifier:
    """D4 베타 게이트 — identity 가입에 주입한다(identity 는 hoondok 을 직접 import 하지 않는다)."""
    ip = extract_client_ip(request)
    return GroupInviteVerifier(service, lambda: invite_limiter.check(ip))
