"""원문 기반 AI 요약 조회 및 관리자 편집."""

import uuid
from fastapi import APIRouter, Depends, File, UploadFile, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.common.database import get_async_session
from app.core.config import settings
from app.modules.admin.dependencies import (
    get_current_admin,
    get_admin_service,
    verify_csrf,
)
from app.modules.admin.service import AdminService
from app.modules.qdrant import get_raw_client
from app.modules.hoondok.summary_repository import SummaryRepository
from app.modules.hoondok.summary_service import SummaryService
from app.modules.hoondok.summary_schemas import (
    SummaryInput,
    SummaryUpdate,
    SummaryActionInput,
    SummaryAdminResponse,
    SummaryMediaResponse,
    SummaryListItem,
    SummaryDetail,
    SummaryPublicSource,
    SummaryTocItem,
)
from typing import Literal
from fastapi import Query

router = APIRouter(prefix="/hoondok/ai-summaries", tags=["hoondok"])
admin_router = APIRouter(
    prefix="/admin/hoondok/ai-summaries",
    tags=["admin-hoondok"],
    dependencies=[Depends(get_current_admin), Depends(verify_csrf)],
)


def service(session: AsyncSession = Depends(get_async_session)):
    return SummaryService(
        SummaryRepository(session), settings.hoondok_summary_media_dir, get_raw_client()
    )


def no_cache(response: Response):
    response.headers["Cache-Control"] = "private, no-store"


@router.get("", response_model=list[SummaryListItem])
async def list_summaries(
    response: Response,
    content_right_id: uuid.UUID | None = None,
    volume: str | None = None,
    svc: SummaryService = Depends(service),
):
    no_cache(response)
    return await svc.list_public(content_right_id, volume)


@router.get("/{unit_id}", response_model=SummaryDetail)
async def summary_detail(
    unit_id: uuid.UUID, response: Response, svc: SummaryService = Depends(service)
):
    no_cache(response)
    return await svc.detail(unit_id)


@router.get("/{unit_id}/source", response_model=SummaryPublicSource)
async def summary_source(
    unit_id: uuid.UUID, response: Response, svc: SummaryService = Depends(service)
):
    no_cache(response)
    _, _, payload = await svc.published(unit_id)
    return payload["source"]


@router.get("/{unit_id}/media/{asset_id}")
async def summary_media(
    unit_id: uuid.UUID, asset_id: uuid.UUID, svc: SummaryService = Depends(service)
):
    path, mime = await svc.media(unit_id, asset_id)
    return FileResponse(
        path,
        media_type=mime,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@admin_router.get("", response_model=list[SummaryAdminResponse])
async def admin_list_summaries(
    response: Response, svc: SummaryService = Depends(service)
):
    no_cache(response)
    return [await svc.admin_item(u) for u in await svc.repo.units()]


@admin_router.get("/cheonseong-toc", response_model=list[SummaryTocItem])
async def admin_cheonseong_toc(
    response: Response,
    status: Literal["none", "draft", "review", "published", "withdrawn"]
    | None = None,
    pyeon: int | None = Query(default=None, ge=1, le=13),
    svc: SummaryService = Depends(service),
):
    """천성경 편·장·절 199절 발행 관리 목록. 상태·편으로 거른다."""
    no_cache(response)
    return await svc.admin_toc(status, pyeon)


@admin_router.get("/{unit_id}", response_model=SummaryAdminResponse)
async def admin_summary_detail(
    unit_id: uuid.UUID, response: Response, svc: SummaryService = Depends(service)
):
    no_cache(response)
    return await svc.admin_item(await svc.unit(unit_id))


@admin_router.post("", response_model=SummaryAdminResponse, status_code=201)
async def create_summary(
    data: SummaryInput,
    svc: SummaryService = Depends(service),
    audit: AdminService = Depends(get_admin_service),
    admin: dict = Depends(get_current_admin),
):
    return await svc.create(data, audit, admin["user_id"])


@admin_router.put("/{unit_id}", response_model=SummaryAdminResponse)
async def update_summary(
    unit_id: uuid.UUID,
    data: SummaryUpdate,
    svc: SummaryService = Depends(service),
    audit: AdminService = Depends(get_admin_service),
    admin: dict = Depends(get_current_admin),
):
    return await svc.update(unit_id, data, audit, admin["user_id"])


@admin_router.post("/{unit_id}/actions", response_model=SummaryAdminResponse)
async def summary_action(
    unit_id: uuid.UUID,
    data: SummaryActionInput,
    svc: SummaryService = Depends(service),
    audit: AdminService = Depends(get_admin_service),
    admin: dict = Depends(get_current_admin),
):
    return await svc.action(unit_id, data, audit, admin["user_id"])


@admin_router.post(
    "/{unit_id}/media", response_model=SummaryMediaResponse, status_code=201
)
async def upload_summary_image(
    unit_id: uuid.UUID,
    file: UploadFile = File(...),
    svc: SummaryService = Depends(service),
    audit: AdminService = Depends(get_admin_service),
    admin: dict = Depends(get_current_admin),
):
    blob = await file.read(10 * 1024 * 1024 + 1)
    return await svc.upload(unit_id, blob, audit, admin["user_id"])


@admin_router.get("/{unit_id}/media/{asset_id}")
async def admin_summary_media(
    unit_id: uuid.UUID, asset_id: uuid.UUID, svc: SummaryService = Depends(service)
):
    path, mime = await svc.media(unit_id, asset_id, admin=True)
    return FileResponse(
        path,
        media_type=mime,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
