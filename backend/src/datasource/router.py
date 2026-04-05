"""데이터 소스 카테고리 관리자 API 라우터."""

import uuid

from fastapi import APIRouter, Depends

from src.admin.dependencies import get_current_admin, verify_csrf
from src.datasource.dependencies import get_datasource_service
from src.datasource.schemas import (
    DataSourceCategoryCreate,
    DataSourceCategoryResponse,
    DataSourceCategoryUpdate,
)
from src.datasource.service import DataSourceCategoryService

router = APIRouter(
    prefix="/admin/data-source-categories",
    tags=["data-source-categories"],
    dependencies=[Depends(get_current_admin)],
)


@router.get("", response_model=list[DataSourceCategoryResponse])
async def list_categories(
    service: DataSourceCategoryService = Depends(get_datasource_service),
):
    """전체 카테고리 목록 (비활성 포함)."""
    return await service.list_all()


@router.post(
    "",
    response_model=DataSourceCategoryResponse,
    status_code=201,
    dependencies=[Depends(verify_csrf)],
)
async def create_category(
    data: DataSourceCategoryCreate,
    service: DataSourceCategoryService = Depends(get_datasource_service),
):
    """카테고리 생성."""
    return await service.create(data)


@router.put(
    "/{category_id}",
    response_model=DataSourceCategoryResponse,
    dependencies=[Depends(verify_csrf)],
)
async def update_category(
    category_id: uuid.UUID,
    data: DataSourceCategoryUpdate,
    service: DataSourceCategoryService = Depends(get_datasource_service),
):
    """카테고리 수정 (key 변경 불가)."""
    return await service.update(category_id, data)


@router.delete(
    "/{category_id}",
    status_code=204,
    dependencies=[Depends(verify_csrf)],
)
async def delete_category(
    category_id: uuid.UUID,
    service: DataSourceCategoryService = Depends(get_datasource_service),
):
    """카테고리 비활성화 (soft delete)."""
    await service.delete(category_id)
