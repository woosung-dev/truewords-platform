"""볼륨 삭제 감사 로그에 관리자 이메일이 남는지 회귀 테스트.

principal 에는 username 키가 없어서 감사 로그의 admin 값이 항상 None 이던 버그.
"""

from __future__ import annotations

import logging
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.admin import data_router
from app.modules.admin.dependencies import AdminPrincipal
from app.modules.datasource.schemas import VolumeDeleteRequest

ADMIN: AdminPrincipal = {"user_id": uuid.uuid4(), "role": "admin", "email": "admin@example.com"}


@pytest.fixture
def stub_artifacts():
    result = {
        "volume": "v",
        "chunks_deleted": 3,
        "ingestion_row_deleted": False,
        "batch_rows_deleted": 0,
        "skipped": [],
    }
    with patch.object(
        data_router, "_delete_volume_artifacts", AsyncMock(return_value=result)
    ):
        yield


@pytest.mark.asyncio
async def test_delete_volume_audit_log_has_admin_email(stub_artifacts, caplog):
    with caplog.at_level(logging.WARNING, logger=data_router.logger.name):
        response = await data_router.delete_volume("v", ADMIN, MagicMock())
    assert "admin=admin@example.com" in caplog.text
    assert response.deleted_volumes == ["v"]
    assert response.total_chunks_deleted == 3


@pytest.mark.asyncio
async def test_delete_volumes_bulk_audit_log_has_admin_email(stub_artifacts, caplog):
    with caplog.at_level(logging.WARNING, logger=data_router.logger.name):
        response = await data_router.delete_volumes_bulk(
            VolumeDeleteRequest(volumes=["v"]), ADMIN, MagicMock()
        )
    assert "admin=admin@example.com" in caplog.text
    assert response.deleted_volumes == ["v"]
