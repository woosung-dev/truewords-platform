"""훈독 DI 조립."""

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.common.database import get_async_session
from app.core.config import settings
from app.core.common.ingestion_facade import IngestionJobRepository
from app.modules.chat.dependencies import get_chat_repository, get_ingestion_repository
from app.modules.chat.repository import ChatRepository
from app.modules.chat.service import ChatService
from app.modules.chatbot.dependencies import get_chatbot_service
from app.modules.chatbot.service import ChatbotService
from app.modules.hoondok.asks_repository import AskRepository
from app.modules.hoondok.asks_service import AskService
from app.modules.hoondok.cards_repository import CardRepository
from app.modules.hoondok.cards_service import CardAdminService, CardService
from app.modules.hoondok.groups_repository import GroupRepository
from app.modules.hoondok.groups_service import GroupAdminService, GroupInviteVerifier, GroupService
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.library_repository import LibraryRepository
from app.modules.hoondok.library_service import LibraryService
from app.modules.hoondok.notifications_repository import NotificationRepository
from app.modules.hoondok.notifications_service import NotificationService
from app.modules.hoondok.public_questions_repository import PublicQuestionRepository
from app.modules.hoondok.public_questions_service import PublicQuestionAdminService, PublicQuestionService
from app.modules.hoondok.repository import DailyReadingRepository, JeongseongRepository, MissionLogRepository
from app.modules.hoondok.service import (
    DailyReadingAdminService,
    DailyReadingCandidateService,
    HoondokService,
    JeongseongService,
    MissionService,
)
from app.modules.hoondok.together_service import TogetherService
from app.modules.hoondok.tts_repository import TtsRepository
from app.modules.hoondok.tts_service import TtsService
from app.modules.qdrant import get_raw_client  # raw httpx — SDK HTTP/2 hang 회피 (docs/dev-log/47)
from app.modules.safety.middleware import extract_client_ip
from app.modules.safety.rate_limiter import RateLimiter

# 초대 코드 추측 방어 (PLAN-HD-010 §5). 미리보기(API-HD-035)와 참여(API-HD-036)를 따로 센다.
# 교회 Wi-Fi 처럼 NAT 하나 뒤에서 식구 10~15명이 한꺼번에 들어와도 막히지 않도록 IP 당 30회/60초로 둔다.
# 코드는 40bit 무작위(약 1.1조 가지)라 30회/분이면 공간 절반을 훑는 데 약 3.5만 년 — 추측 방어는 충분하다.
# 가입(API-HD-002)의 모임 코드 검증은 참여 limiter 를 함께 쓴다(코드로 들어오는 경로이므로).
# [가정] 인메모리·단일 워커 전제 — RateLimiter 주석 참고.
invite_preview_limiter = RateLimiter(max_requests=30, window_seconds=60)
invite_join_limiter = RateLimiter(max_requests=30, window_seconds=60)


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
    readings: DailyReadingRepository = Depends(get_hoondok_repository),
) -> MissionService:
    # 연속일(API-HD-004)이 편성 없는 날을 건너뛰려고 편성 리포를 함께 받는다. 같은 요청 세션을 공유한다.
    return MissionService(repo, readings)


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
    return LibraryService(repo, get_raw_client())


async def get_journey_service(
    repo: JourneyRepository = Depends(get_journey_repository),
    periods: JeongseongRepository = Depends(get_jeongseong_repository),
    library: LibraryRepository = Depends(get_library_repository),
) -> JourneyService:
    # 장 목차(ENT-HD-010)는 서고 리포가 읽는다 — API-HD-016 의 section 동봉에 필요하다.
    return JourneyService(repo, get_raw_client(), periods, library=library)


async def get_tts_repository(session: AsyncSession = Depends(get_async_session)) -> TtsRepository:
    return TtsRepository(session)


async def get_tts_service(
    repo: TtsRepository = Depends(get_tts_repository),
    journey: JourneyService = Depends(get_journey_service),
) -> TtsService:
    key = settings.google_tts_api_key
    return TtsService(
        repo,
        journey,
        api_key=key.get_secret_value() if key else None,
        monthly_limit=settings.hoondok_tts_monthly_char_limit,
        user_daily_limit=settings.hoondok_tts_user_daily_char_limit,
        cache_dir=settings.hoondok_tts_cache_dir,
    )


async def get_notification_repository(
    session: AsyncSession = Depends(get_async_session),
) -> NotificationRepository:
    return NotificationRepository(session)


async def get_notification_service(
    repo: NotificationRepository = Depends(get_notification_repository),
) -> NotificationService:
    return NotificationService(repo)


async def check_invite_preview_limit(request: Request) -> None:
    invite_preview_limiter.check(extract_client_ip(request))


async def check_invite_join_limit(request: Request) -> None:
    invite_join_limiter.check(extract_client_ip(request))


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
    return GroupInviteVerifier(service, lambda: invite_join_limiter.check(ip))


async def get_card_repository(session: AsyncSession = Depends(get_async_session)) -> CardRepository:
    return CardRepository(session)


async def get_card_service(repo: CardRepository = Depends(get_card_repository)) -> CardService:
    return CardService(repo)


async def get_card_admin_service(repo: CardRepository = Depends(get_card_repository)) -> CardAdminService:
    return CardAdminService(repo)


async def get_public_question_repository(
    session: AsyncSession = Depends(get_async_session),
) -> PublicQuestionRepository:
    return PublicQuestionRepository(session)


async def get_public_question_service(
    repo: PublicQuestionRepository = Depends(get_public_question_repository),
) -> PublicQuestionService:
    return PublicQuestionService(repo)


async def get_public_question_admin_service(
    repo: PublicQuestionRepository = Depends(get_public_question_repository),
) -> PublicQuestionAdminService:
    return PublicQuestionAdminService(repo)


async def get_ask_repository(session: AsyncSession = Depends(get_async_session)) -> AskRepository:
    return AskRepository(session)


async def get_ask_service(repo: AskRepository = Depends(get_ask_repository)) -> AskService:
    """목록·상세·횟수 조회용 — 채팅 파이프라인(캐시 lazy init 포함)을 조립하지 않는다."""
    return AskService(repo, None, daily_limit=settings.hoondok_ask_daily_limit)


async def get_ask_chat_service(
    chat_repo: ChatRepository = Depends(get_chat_repository),
    chatbot_service: ChatbotService = Depends(get_chatbot_service),
    ingestion_repo: IngestionJobRepository = Depends(get_ingestion_repository),
) -> ChatService:
    """훈독 AI 질문용 채팅 파이프라인 — 시맨틱 캐시를 끈다(cache_service=None, 조회·저장 모두).

    캐시는 사용자 구분 없이 공유된다. 켜 두면 비공개 질문 원문과 답이 Qdrant 에 남아 계정·대화 삭제 뒤에도 TTL(7일) 동안
    보관되고, 비슷한 첫 질문을 한 다른 계정에 그 답이 그대로 나갈 수 있다(비공개 = 내 계정에서만, DEC-PWA-025 2차).
    """
    return ChatService(
        chat_repo=chat_repo,
        chatbot_service=chatbot_service,
        cache_service=None,
        ingestion_repo=ingestion_repo,
    )


async def get_ask_stream_service(
    repo: AskRepository = Depends(get_ask_repository),
    chat: ChatService = Depends(get_ask_chat_service),
) -> AskService:
    # get_async_session 은 요청당 캐시되므로 횟수 차감·답 기록과 채팅 파이프라인이 같은 세션을 쓴다.
    return AskService(repo, chat, daily_limit=settings.hoondok_ask_daily_limit)
