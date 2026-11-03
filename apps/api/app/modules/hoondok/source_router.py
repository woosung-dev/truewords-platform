"""관리자 원문 탐색·운영자 편집 구간. 내부 청크 주소 입력은 받지 않는다."""
import uuid
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.common.database import get_async_session
from app.core.config import settings
from app.modules.admin.dependencies import get_current_admin, get_admin_service, verify_csrf
from app.modules.admin.service import AdminService
from app.modules.qdrant import get_raw_client
from app.modules.hoondok.source_repository import SourceRepository
from app.modules.hoondok.source_service import SourceService
from app.modules.hoondok.source_schemas import (
    SourceBook, SourceSnapshotInfo, SourcePassages, SourceRangeInput,
    SourceRangeUpdate, SourceRangeResult, SourceRangeSplit, SourceRangeMerge,
)

router = APIRouter(prefix='/admin/hoondok', tags=['admin-hoondok-sources'], dependencies=[Depends(get_current_admin), Depends(verify_csrf)])


def service(session: AsyncSession = Depends(get_async_session)):
    return SourceService(SourceRepository(session), get_raw_client(), settings.collection_name)


def private(response: Response):
    response.headers['Cache-Control'] = 'private, no-store'


@router.get('/source-books', response_model=list[SourceBook])
async def source_books(response: Response, svc: SourceService = Depends(service)):
    private(response)
    return await svc.books()


@router.post('/source-books/{right_id}/snapshots', response_model=SourceSnapshotInfo)
async def create_snapshot(right_id: uuid.UUID, response: Response, svc: SourceService = Depends(service)):
    private(response)
    return await svc.make_snapshot(right_id)


@router.get('/source-snapshots/{snapshot_id}/passages', response_model=SourcePassages)
async def source_passages(snapshot_id: uuid.UUID, response: Response, offset: int = Query(default=0, ge=0), limit: int = Query(default=40, ge=1, le=200), start_block_id: str | None = Query(default=None, max_length=36), svc: SourceService = Depends(service)):
    private(response)
    return await svc.passages(snapshot_id, offset, limit, start_block_id)


@router.get('/source-ranges', response_model=list[SourceRangeResult])
async def source_ranges(response: Response, content_right_id: uuid.UUID | None = None, svc: SourceService = Depends(service)):
    private(response)
    return await svc.list_ranges(content_right_id)


@router.get('/source-ranges/{range_id}', response_model=SourceRangeResult)
async def source_range(range_id: uuid.UUID, response: Response, svc: SourceService = Depends(service)):
    private(response)
    return await svc.result(await svc.get_range(range_id))


@router.post('/source-ranges', response_model=SourceRangeResult, status_code=201)
async def create_range(data: SourceRangeInput, response: Response, svc: SourceService = Depends(service), audit: AdminService = Depends(get_admin_service), admin: dict = Depends(get_current_admin)):
    private(response)
    return await svc.create_range(data, audit, admin['user_id'])


@router.put('/source-ranges/{range_id}', response_model=SourceRangeResult)
async def update_range(range_id: uuid.UUID, data: SourceRangeUpdate, response: Response, svc: SourceService = Depends(service), audit: AdminService = Depends(get_admin_service), admin: dict = Depends(get_current_admin)):
    private(response)
    return await svc.update_range(range_id, data, audit, admin['user_id'])


@router.post('/source-ranges/{range_id}/split', response_model=list[SourceRangeResult])
async def split_range(range_id: uuid.UUID, data: SourceRangeSplit, response: Response, svc: SourceService = Depends(service), audit: AdminService = Depends(get_admin_service), admin: dict = Depends(get_current_admin)):
    private(response)
    return await svc.split(range_id, data, audit, admin['user_id'])


@router.post('/source-ranges/{range_id}/merge', response_model=SourceRangeResult)
async def merge_ranges(range_id: uuid.UUID, data: SourceRangeMerge, response: Response, svc: SourceService = Depends(service), audit: AdminService = Depends(get_admin_service), admin: dict = Depends(get_current_admin)):
    private(response)
    return await svc.merge(range_id, data, audit, admin['user_id'])
