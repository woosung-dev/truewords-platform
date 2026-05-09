# 데이터 소스 display_name 인라인 편집 + chat 응답 lookup 회귀 잠금 테스트.
"""display_name 매핑 경로 단위/회귀 테스트.

전체 통합(DB+Qdrant+Gemini)은 mock 비용이 커서 본 테스트는 다음 축으로 한정:
1. 스키마 잠금 — IngestionJobInfo / UpdateDisplayNameRequest 의 필드 시그니처
2. Repository / Service 시그니처 잠금
3. ChatService._build_display_name_lookup 동작 — ingestion_repo None / 정상 / 예외
"""

from __future__ import annotations

import inspect
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from src.chat.schemas import Source
from src.chat.service import ChatService
from src.datasource.schemas import IngestionJobInfo, UpdateDisplayNameRequest
from src.pipeline.ingestion_models import IngestionJob, IngestionStatus
from src.pipeline.ingestion_repository import IngestionJobRepository
from src.pipeline.ingestion_service import IngestionJobService
from src.pipeline.metadata import derive_volume


# --- 스키마 ---


def test_ingestion_job_info_required_fields():
    """admin /jobs 응답 schema — display_name 만 nullable."""
    info = IngestionJobInfo(
        volume_key="말씀선집_167권.txt",
        filename="말씀선집_167권.txt",
        source="A",
        display_name=None,
        status="completed",
        total_chunks=120,
    )
    assert info.display_name is None
    assert info.status == "completed"


def test_update_display_name_request_validates_volume_key():
    """volume_key 가 빈 문자열이면 ValidationError."""
    with pytest.raises(ValidationError):
        UpdateDisplayNameRequest(volume_key="", display_name="ok")
    # display_name 은 None 허용
    req = UpdateDisplayNameRequest(volume_key="vk", display_name=None)
    assert req.display_name is None


def test_chat_source_has_display_name_field():
    """chat 응답의 Source 에 display_name 이 들어가는지 잠금."""
    src = Source(volume="167", text="t", score=0.5, source="A", display_name="말씀선집 167권")
    assert src.display_name == "말씀선집 167권"
    # default None
    src2 = Source(volume="1", text="t", score=0.0, source="")
    assert src2.display_name is None


# --- Repository / Service 시그니처 ---


def test_repository_has_update_display_name():
    assert hasattr(IngestionJobRepository, "update_display_name")
    sig = inspect.signature(IngestionJobRepository.update_display_name)
    assert "volume_key" in sig.parameters
    assert "display_name" in sig.parameters


def test_service_has_update_display_name_and_list_jobs():
    assert hasattr(IngestionJobService, "update_display_name")
    assert hasattr(IngestionJobService, "list_jobs")


# --- ChatService lookup 빌드 ---


def _make_chat_service_with_repo(repo) -> ChatService:
    """단순 lookup helper 만 검증 — 다른 stage 는 사용 안 함."""
    chat_repo = MagicMock()
    chatbot_service = MagicMock()
    return ChatService(
        chat_repo=chat_repo,
        chatbot_service=chatbot_service,
        cache_service=None,
        ingestion_repo=repo,
    )


@pytest.mark.asyncio
async def test_build_display_name_lookup_returns_empty_when_no_repo():
    """ingestion_repo 가 None 이면 빈 dict — chat UI 가 fallback 처리."""
    service = _make_chat_service_with_repo(None)
    result = await service._build_display_name_lookup()
    assert result == {}


@pytest.mark.asyncio
async def test_build_display_name_lookup_returns_empty_on_exception():
    """repo 조회 예외도 silent — chat 본 흐름이 막히면 안 된다."""
    repo = MagicMock()
    repo.list_all = AsyncMock(side_effect=RuntimeError("DB down"))
    service = _make_chat_service_with_repo(repo)
    result = await service._build_display_name_lookup()
    assert result == {}


@pytest.mark.asyncio
async def test_build_display_name_lookup_maps_source_and_derived_volume():
    """(source, derive_volume(volume_key)) → display_name 매핑.

    chunk payload.volume = derive_volume(volume_key) 라 chat 응답 매칭이 일치한다.
    """
    job1 = IngestionJob(
        volume_key="말씀선집_167권.txt",
        filename="말씀선집_167권.txt",
        source="A",
        status=IngestionStatus.COMPLETED,
        total_chunks=10,
        display_name="말씀선집 167권",
    )
    job2 = IngestionJob(
        volume_key="원리강론.pdf",
        filename="원리강론.pdf",
        source="B",
        status=IngestionStatus.COMPLETED,
        total_chunks=20,
        display_name=None,  # display_name 미설정 → lookup dict 에서 제외
    )
    job3 = IngestionJob(
        volume_key="천성경.docx",
        filename="천성경.docx",
        source="L",
        status=IngestionStatus.COMPLETED,
        total_chunks=5,
        display_name="천성경",
    )
    repo = MagicMock()
    repo.list_all = AsyncMock(return_value=[job1, job2, job3])
    service = _make_chat_service_with_repo(repo)

    lookup = await service._build_display_name_lookup()

    expected_key1 = ("A", derive_volume("말씀선집_167권.txt"))
    expected_key3 = ("L", derive_volume("천성경.docx"))
    assert lookup[expected_key1] == "말씀선집 167권"
    assert lookup[expected_key3] == "천성경"
    # display_name=None 은 제외
    assert ("B", derive_volume("원리강론.pdf")) not in lookup
