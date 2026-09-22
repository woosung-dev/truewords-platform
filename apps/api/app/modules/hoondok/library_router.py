"""말씀 서고 3계층·읽기 기록 API (API-HD-023~026).

서고·목차는 공개, `/hoondok/me/*` 는 `hoondok_token` 이며 쓰기는 CSRF 헤더를 요구한다.
목차 경로가 `/hoondok/sections/{volume:path}` 인 이유: `/hoondok/words/{volume:path}` 가 greedy 라
`/hoondok/words/<권>/sections` 를 volume 으로 삼켜 버린다(PLAN-HD-007 트랙 A 조사).
"""

from fastapi import APIRouter, Depends, Query, status

from app.modules.hoondok.dependencies import get_library_service
from app.modules.hoondok.journey_router import check_words_limit
from app.modules.hoondok.library_schemas import (
    MarkInput,
    MarkItem,
    MarksResponse,
    ReadingPositionInput,
    ReadingPositionItem,
    ReadingPositionsResponse,
    SectionsResponse,
    SeriesDetailResponse,
)
from app.modules.hoondok.library_service import LibraryService
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User

router = APIRouter(prefix="/hoondok", tags=["hoondok"])


@router.get("/library/{series}", response_model=SeriesDetailResponse)
async def get_series(
    series: str,
    service: LibraryService = Depends(get_library_service),
) -> SeriesDetailResponse:
    """API-HD-023 시리즈의 허용 권 목록. 미등록·허용 0건은 404."""
    return await service.series_detail(series)


@router.get(
    "/sections/{volume:path}",
    response_model=SectionsResponse,
    dependencies=[Depends(check_words_limit)],
)
async def get_sections(
    volume: str,
    service: LibraryService = Depends(get_library_service),
) -> SectionsResponse:
    """API-HD-024 장 목차. 권리 게이트는 API-HD-016 과 같고 0건이면 빈 배열 200."""
    return await service.sections(volume)


@router.get("/me/reading-positions", response_model=ReadingPositionsResponse)
async def get_reading_positions(
    limit: int = Query(default=5, ge=1, le=50),
    volume: str | None = Query(default=None, max_length=512),
    user: User = Depends(get_current_user),
    service: LibraryService = Depends(get_library_service),
) -> ReadingPositionsResponse:
    """API-HD-025 이어 읽기 목록(최신순). `volume` 을 주면 그 권만. 401 미인증."""
    return await service.list_positions(user.id, limit, volume)


@router.put(
    "/me/reading-position/{volume:path}",
    response_model=ReadingPositionItem,
    dependencies=[Depends(verify_csrf)],
)
async def put_reading_position(
    volume: str,
    data: ReadingPositionInput,
    user: User = Depends(get_current_user),
    service: LibraryService = Depends(get_library_service),
) -> ReadingPositionItem:
    """API-HD-025 이어 읽기 upsert. 404 원문 미허용, 403 CSRF, 401 미인증."""
    return await service.save_position(user.id, volume, data.chunk_index)


@router.get("/me/marks", response_model=MarksResponse)
async def get_marks(
    volume: str | None = Query(default=None, max_length=512),
    kind: str | None = Query(default=None, pattern="^(bookmark|highlight)$"),
    user: User = Depends(get_current_user),
    service: LibraryService = Depends(get_library_service),
) -> MarksResponse:
    """API-HD-026 내 표시 목록(최신순). 본인 것만 나온다. 401 미인증."""
    return await service.list_marks(user.id, volume, kind)


@router.put(
    "/me/marks/{chunk_id}",
    response_model=MarkItem,
    dependencies=[Depends(verify_csrf)],
)
async def put_mark(
    chunk_id: str,
    data: MarkInput,
    user: User = Depends(get_current_user),
    service: LibraryService = Depends(get_library_service),
) -> MarkItem:
    """API-HD-026 표시 upsert(`user·chunk_id·kind`). 422 형광펜 색 누락, 404 미허용, 403 CSRF, 401."""
    return await service.save_mark(user.id, chunk_id, data)


@router.delete(
    "/me/marks/{chunk_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
async def delete_mark(
    chunk_id: str,
    kind: str | None = Query(default=None, pattern="^(bookmark|highlight)$"),
    user: User = Depends(get_current_user),
    service: LibraryService = Depends(get_library_service),
) -> None:
    """API-HD-026 표시 삭제. 본인 것만 지우고 없어도 204. 403 CSRF, 401 미인증."""
    await service.delete_mark(user.id, chunk_id, kind)
