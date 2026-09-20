"""훈독 편성 admin 라우터 — /admin/hoondok/daily-readings (API-HD-006~008·012, PLAN-HD-001 Phase 3 A · PLAN-HD-003).

main.py 의 관리자 블록에 `_ADMIN_GATE`(require_admin_gate) 로 등록한다. 상태 변경은 라우터 레벨 verify_csrf.
편성자는 비개발자(결정 2026-09-19) — 이 API 위에 apps/admin 편성 화면(sub-PR B)이 올라간다.

**라우트 순서 주의**: `GET /candidates` 는 반드시 `GET /{reading_id}` **앞에** 있어야 한다.
FastAPI 는 등록 순서로 매칭하므로 뒤에 두면 "candidates" 가 UUID 로 파싱돼 422 가 난다.
`tests/test_hoondok_candidates.py` 가 이 순서를 고정한다.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, status

from app.modules.admin.dependencies import get_admin_service, get_current_admin, verify_csrf
from app.modules.admin.service import AdminService
from app.modules.hoondok.dependencies import (
    get_daily_reading_admin_service,
    get_daily_reading_candidate_service,
)
from app.modules.hoondok.schemas import (
    DailyReadingAdminCreate,
    DailyReadingAdminResponse,
    DailyReadingAdminUpdate,
    DailyReadingCandidateResponse,
)
from app.modules.hoondok.service import (
    DEFAULT_CANDIDATE_LIMIT,
    DEFAULT_CANDIDATE_MAX_LEN,
    DEFAULT_CANDIDATE_MIN_LEN,
    MAX_CANDIDATE_LIMIT,
    DailyReadingAdminService,
    DailyReadingCandidateService,
)

admin_router = APIRouter(
    prefix="/admin/hoondok/daily-readings",
    tags=["admin-hoondok"],
    dependencies=[Depends(verify_csrf)],
)

TARGET_TABLE = "daily_readings"


@admin_router.get("", response_model=list[DailyReadingAdminResponse])
async def list_daily_readings(
    from_: date | None = Query(default=None, alias="from", description="시작일(KST). 기본 오늘"),
    to: date | None = Query(default=None, description="종료일(포함). 기본 시작일 +14일"),
    service: DailyReadingAdminService = Depends(get_daily_reading_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> list[DailyReadingAdminResponse]:
    """API-HD-006 편성 목록. 날짜 오름차순, 편성 없는 날은 행이 없다. 422 종료일 < 시작일 또는 366일 초과."""
    readings = await service.list(from_, to)
    return [DailyReadingAdminResponse.model_validate(r, from_attributes=True) for r in readings]


@admin_router.get("/candidates", response_model=DailyReadingCandidateResponse)
async def search_daily_reading_candidates(
    q: str = Query(min_length=1, max_length=200, description="주제·키워드"),
    sources: list[str] | None = Query(default=None, description="코퍼스 카테고리 키(L/M/N/O/B/P/Q). 생략 시 전체"),
    min_len: int = Query(default=DEFAULT_CANDIDATE_MIN_LEN, ge=1, le=2000, description="본문 최소 글자 수"),
    max_len: int = Query(default=DEFAULT_CANDIDATE_MAX_LEN, ge=1, le=2000, description="본문 최대 글자 수"),
    limit: int = Query(default=DEFAULT_CANDIDATE_LIMIT, ge=1, le=MAX_CANDIDATE_LIMIT),
    service: DailyReadingCandidateService = Depends(get_daily_reading_candidate_service),
    current_admin: dict = Depends(get_current_admin),
) -> DailyReadingCandidateResponse:
    """API-HD-012 편성 후보 검색(추출형).

    말씀 코퍼스에서 **원문 그대로** 후보를 찾아 준다. 생성 LLM 을 부르지 않으므로
    돌아오는 본문은 편집되지 않은 청크이고 `chunk_id` 로 원문까지 역추적된다.
    조건에 맞는 후보가 없어도 200 · 빈 배열이다. 422 검색어 없음·길이 역전 · 502 검색 실패.
    """
    return await service.search(q, sources=sources, min_len=min_len, max_len=max_len, limit=limit)


@admin_router.get("/{reading_id}", response_model=DailyReadingAdminResponse)
async def get_daily_reading(
    reading_id: uuid.UUID,
    service: DailyReadingAdminService = Depends(get_daily_reading_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> DailyReadingAdminResponse:
    """API-HD-006 편성 단건. 404 없음."""
    return DailyReadingAdminResponse.model_validate(await service.get(reading_id), from_attributes=True)


@admin_router.post("", response_model=DailyReadingAdminResponse, status_code=status.HTTP_201_CREATED)
async def create_daily_reading(
    data: DailyReadingAdminCreate,
    service: DailyReadingAdminService = Depends(get_daily_reading_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> DailyReadingAdminResponse:
    """API-HD-007 편성 등록. 201 · 409 같은 날짜 · 422 검증."""
    reading = await service.create(data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="daily_reading.create",
        target_table=TARGET_TABLE,
        target_id=reading.id,
        changes=data.model_dump(mode="json"),
    )
    return DailyReadingAdminResponse.model_validate(reading, from_attributes=True)


@admin_router.put("/{reading_id}", response_model=DailyReadingAdminResponse)
async def update_daily_reading(
    reading_id: uuid.UUID,
    data: DailyReadingAdminUpdate,
    service: DailyReadingAdminService = Depends(get_daily_reading_admin_service),
    admin_service: AdminService = Depends(get_admin_service),
    current_admin: dict = Depends(get_current_admin),
) -> DailyReadingAdminResponse:
    """API-HD-008 편성 수정(보낸 필드만). `review_status=withdrawn` 이 철회. 404 없음 · 409 날짜 충돌."""
    reading = await service.update(reading_id, data)
    await admin_service.log_audit(
        admin_user_id=current_admin["user_id"],
        action="daily_reading.update",
        target_table=TARGET_TABLE,
        target_id=reading_id,
        changes=data.model_dump(exclude_unset=True, mode="json"),
    )
    return DailyReadingAdminResponse.model_validate(reading, from_attributes=True)
