"""7일 정성 API (읽기 정성 1a) — /hoondok/paths · /hoondok/me/path-runs/*. 로그인 필수, 플래그 OFF 면 모두 404."""

from fastapi import APIRouter, Depends, Path, status

from app.modules.hoondok.dependencies import get_path_service, require_paths_enabled
from app.modules.hoondok.paths_schemas import (
    PathRunCurrentResponse,
    PathRunFinishRequest,
    PathRunStart,
    PathStepCompleteRequest,
    PathStepCompleteResponse,
    PathStepContentResponse,
    ReadingPathListResponse,
)
from app.modules.hoondok.paths_service import PathService
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User

router = APIRouter(prefix="/hoondok", tags=["hoondok"], dependencies=[Depends(require_paths_enabled)])

CURRENT = "/me/path-runs/current"
DAY_INDEX = Path(ge=1, le=366)


@router.get("/paths", response_model=ReadingPathListResponse)
async def list_reading_paths(
    _user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
) -> ReadingPathListResponse:
    """발행된 정성 목록(장 권리가 모두 열린 것만)과 하루 분량 단계별 예상 분. 401 미인증."""
    return await service.list_paths()


@router.post(
    "/me/path-runs",
    response_model=PathRunCurrentResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def start_path_run(
    data: PathRunStart,
    user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
) -> PathRunCurrentResponse:
    """정성 시작. 409 PATH_RUN_ACTIVE·JEONGSEONG_ACTIVE, 403 RIGHTS_CLOSED, 404 PATH_NOT_FOUND."""
    return await service.start(user.id, data)


@router.get(CURRENT, response_model=PathRunCurrentResponse)
async def get_current_path_run(
    user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
) -> PathRunCurrentResponse:
    """진행 중 run(또는 마침표를 아직 보지 않은 completed run). 없으면 run=null."""
    return await service.get_current(user.id)


@router.delete(CURRENT, status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def abandon_path_run(
    user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
) -> None:
    """그만하기 → abandoned. 읽은 기록은 남는다. 404 PATH_RUN_NOT_FOUND."""
    await service.abandon(user.id)


@router.get(f"{CURRENT}/steps/{{day_index}}", response_model=PathStepContentResponse)
async def get_path_step(
    day_index: int = DAY_INDEX,
    user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
) -> PathStepContentResponse:
    """장 본문. 권리 닫힘·범위 어긋남이면 200 status=withdrawn. 404 PATH_RUN_NOT_FOUND·PATH_STEP_NOT_FOUND."""
    return await service.get_step(user.id, day_index)


@router.post(
    f"{CURRENT}/steps/{{day_index}}/complete",
    response_model=PathStepCompleteResponse,
    dependencies=[Depends(verify_csrf)],
)
async def complete_path_step(
    data: PathStepCompleteRequest,
    day_index: int = DAY_INDEX,
    user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
) -> PathStepCompleteResponse:
    """장 완료(+ 그날 훈독하기 기록). 같은 장 재요청은 200 기존 값. 409 ALREADY_READ_TODAY·STEP_OUT_OF_ORDER."""
    return await service.complete(user.id, day_index, data)


@router.post(f"{CURRENT}/finish", response_model=PathRunCurrentResponse, dependencies=[Depends(verify_csrf)])
async def finish_path_run(
    data: PathRunFinishRequest,
    user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
) -> PathRunCurrentResponse:
    """마친 정성 뒤 다음 행동. next·repeat 은 새 run, rest 는 run=null. 409 PATH_RUN_NOT_COMPLETED."""
    return await service.finish(user.id, data)
