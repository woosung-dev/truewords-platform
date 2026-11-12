"""훈독 identity DI 조립 + 쿠키 인증. admin/dependencies 를 import 하지 않는다."""

import uuid

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.common.database import get_async_session
from app.core.config import settings
from app.modules.admin.auth import decode_access_token
from app.modules.hoondok.cards_repository import CardRepository
from app.modules.hoondok.asks_repository import AskRepository
from app.modules.hoondok.dependencies import (
    get_ask_repository,
    get_card_repository,
    get_jeongseong_repository,
    get_library_repository,
    get_mission_repository,
    get_notification_repository,
    get_path_repository,
    get_public_question_repository,
)
from app.modules.hoondok.library_repository import LibraryRepository
from app.modules.hoondok.notifications_repository import NotificationRepository
from app.modules.hoondok.paths_repository import PathRepository
from app.modules.hoondok.public_questions_repository import PublicQuestionRepository
from app.modules.hoondok.repository import JeongseongRepository, MissionLogRepository
from app.modules.identity.models import User
from app.modules.identity.oauth_service import OAuthService
from app.modules.identity.oidc import LoginProvider, build_login_providers
from app.modules.identity.repository import UserIdentityRepository, UserRepository
from app.modules.identity.service import AUDIENCE, IdentityService, UserDataPurger

COOKIE_NAME = "hoondok_token"


def cookie_opts() -> dict:
    """Set-Cookie 옵션. admin_token 과 같은 보안 속성, 만료만 훈독 값(7일)."""
    return {
        "key": COOKIE_NAME,
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "none" if settings.cookie_secure else "lax",
        "path": "/",
    }


async def get_identity_repository(
    session: AsyncSession = Depends(get_async_session),
) -> UserRepository:
    return UserRepository(session)


async def get_user_identity_repository(
    repo: UserRepository = Depends(get_identity_repository),
) -> UserIdentityRepository:
    # 사용자 저장소와 같은 세션을 공유한다 — 가입·연결·계정 삭제가 한 트랜잭션으로 묶인다.
    return UserIdentityRepository(repo.session)


async def get_identity_service(
    repo: UserRepository = Depends(get_identity_repository),
    identities: UserIdentityRepository = Depends(get_user_identity_repository),
) -> IdentityService:
    return IdentityService(repo, identities)


async def get_oauth_service(
    repo: UserRepository = Depends(get_identity_repository),
    identities: UserIdentityRepository = Depends(get_user_identity_repository),
) -> OAuthService:
    return OAuthService(repo, identities)


def get_login_providers() -> dict[str, LoginProvider]:
    """설정된 로그인 제공자. 테스트·E2E 는 dependency_overrides 로 가짜 제공자를 주입한다."""
    return build_login_providers(settings)


async def get_user_data_purgers(
    missions: MissionLogRepository = Depends(get_mission_repository),
    jeongseong: JeongseongRepository = Depends(get_jeongseong_repository),
    notifications: NotificationRepository = Depends(get_notification_repository),
    library: LibraryRepository = Depends(get_library_repository),
    cards: CardRepository = Depends(get_card_repository),
    public_questions: PublicQuestionRepository = Depends(get_public_question_repository),
    asks: AskRepository = Depends(get_ask_repository),
    paths: PathRepository = Depends(get_path_repository),
) -> list[UserDataPurger]:
    """계정 삭제(API-HD-011)에서 함께 지울 훈독 리포. identity → hoondok 의존은 이 DI 한 곳에만 둔다.

    get_async_session 은 요청당 캐시되므로 UserRepository 와 같은 세션을 공유하고, 삭제는 사용자 저장 커밋에 묶인다.
    """
    # library = reading_positions·passage_marks·passage_highlights
    # cards = card_receipts (PLAN-HD-012), public_questions = 공개 신청한 질문 (DEC-PWA-025)
    # asks = AI 질문 대화(채팅 세션·메시지·근거 포함)·하루 횟수 (DEC-PWA-025 2차)
    # paths = 7일 정성 완료·진행·본인 정성 (읽기 정성 1a)
    return [missions, jeongseong, notifications, library, cards, public_questions, asks, paths]


def decode_hoondok_token(token: str) -> uuid.UUID | None:
    """훈독 토큰 → user id. aud 가 "hoondok" 이 아니면 None.

    python-jose 는 audience 를 넘겨도 토큰에 aud 가 **없으면 통과**시킨다
    (jose/jwt.py _validate_aud). admin_token(aud 없음)이 여기서 통과하지 않도록 aud 를 명시 검사한다.
    """
    payload = decode_access_token(token, audience=AUDIENCE)
    if payload is None or payload.get("aud") != AUDIENCE:
        return None
    try:
        return uuid.UUID(str(payload.get("sub")))
    except ValueError:
        return None


async def get_optional_user(
    request: Request,
    repo: UserRepository = Depends(get_identity_repository),
) -> User | None:
    """hoondok_token 이 유효하고 삭제되지 않은 계정이면 User, 아니면 None. admin_token 은 읽지 않는다."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    user_id = decode_hoondok_token(token)
    if user_id is None:
        return None
    user = await repo.get_by_id(user_id)
    if user is None or user.deleted_at is not None:
        return None
    return user


async def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다")
    return user


async def verify_csrf(request: Request) -> None:
    """상태 변경 요청은 SameSite 쿠키 + 커스텀 헤더(SDK 가 자동 부착)로 CSRF 를 막는다."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if request.headers.get("X-Requested-With") != "XMLHttpRequest":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF 검증 실패")
