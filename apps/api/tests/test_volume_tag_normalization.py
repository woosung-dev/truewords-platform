"""단건 태그 추가가 NFC 로 적재된 한글 volume 을 찾는지 확인한다."""

import json
import unicodedata
from types import SimpleNamespace
from typing import Literal
from unittest.mock import AsyncMock

import pytest

from app.modules.datasource.qdrant_service import DataSourceQdrantService


@pytest.mark.asyncio
@pytest.mark.parametrize("form", ["NFC", "NFD"])
async def test_add_volume_tag_finds_volume_in_either_form(form: Literal["NFC", "NFD"]) -> None:
    stored = unicodedata.normalize(form, "천성경")

    async def scroll(_collection, scroll_filter, **_kwargs):
        # 실제 Qdrant 처럼 저장된 바이트와 정확히 같은 값만 맞는다.
        if stored in json.dumps(scroll_filter, ensure_ascii=False, default=str):
            return [SimpleNamespace(id=1, payload={"source": ["A"]})], None
        return [], None

    client = SimpleNamespace(scroll=scroll, set_payload=AsyncMock())
    service = DataSourceQdrantService(client, "c")  # type: ignore[arg-type]

    # 관리자 화면은 NFC 를 보낸다.
    result = await service.add_volume_tag(unicodedata.normalize("NFC", "천성경"), "B")

    assert result.updated_chunks == 1
    assert result.updated_sources == ["A", "B"]
