"""개인정보 없이 고정 오류 코드·화면 유형만 수집한다."""

from fastapi import APIRouter, Depends, Request

from app.modules.hoondok.dependencies import get_journey_repository
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_schemas import ClientErrorInput
from app.modules.hoondok.models import ClientErrorEvent
from app.modules.identity.dependencies import get_optional_user, verify_csrf
from app.modules.identity.models import User
from app.modules.safety.middleware import extract_client_ip
from app.modules.safety.rate_limiter import RateLimiter

_MESSAGES = {
    "sw_register": "서비스워커 등록 실패",
    "install_prompt": "설치 요청 실패",
    "unhandled": "처리되지 않은 클라이언트 오류",
    "api_5xx": "API 서비스 오류",
    "push_subscribe": "알림 구독 실패",
}
_STATIC_PATHS = {
    "",
    "/read",
    "/library",
    "/search",
    "/ask",
    "/history",
    "/jeongseong",
    "/settings",
    "/login",
    "/signup",
    "/worship",
    "/worship/prepare",
    "/worship/order",
    "/worship/complete",
    "/family",
}
error_limiter = RateLimiter(max_requests=20, window_seconds=60)


def normalize_error_path(value: str) -> str:
    path = value.split("?", 1)[0].split("#", 1)[0]
    if not path.startswith("/hoondok"):
        return "/hoondok"
    tail = path[len("/hoondok") :].rstrip("/")
    if tail in _STATIC_PATHS:
        return "/hoondok" + tail
    for prefix in ("/words/", "/ask/"):
        if tail.startswith(prefix):
            return "/hoondok" + prefix + ":id"
    return "/hoondok/:screen"


async def check_error_limit(request: Request) -> None:
    error_limiter.check(extract_client_ip(request))


class ClientErrorService:
    def __init__(self, repo: JourneyRepository) -> None:
        self.repo = repo

    async def record(self, data: ClientErrorInput, user: User | None) -> None:
        await self.repo.save_error(
            ClientErrorEvent(
                kind=data.kind,
                message=_MESSAGES[data.kind],
                path=normalize_error_path(data.path),
                user_id=user.id if user else None,
            )
        )


async def get_client_error_service(
    repo: JourneyRepository = Depends(get_journey_repository),
) -> ClientErrorService:
    return ClientErrorService(repo)


router = APIRouter(prefix="/hoondok", tags=["hoondok"])


@router.post(
    "/client-errors",
    status_code=204,
    dependencies=[Depends(check_error_limit), Depends(verify_csrf)],
)
async def report_client_error(
    data: ClientErrorInput,
    service: ClientErrorService = Depends(get_client_error_service),
    user: User | None = Depends(get_optional_user),
) -> None:
    await service.record(data, user)
