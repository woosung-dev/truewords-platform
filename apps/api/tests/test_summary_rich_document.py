"""본문 v2의 제한된 표현과 자산 소유권·공개 범위 검증."""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.hoondok.summary_models import SummaryUnit, SummaryRevision
from app.modules.hoondok.summary_schemas import (
    SummaryInput,
    SummarySlide,
    document_asset_ids,
)
from app.modules.hoondok.summary_service import SummaryService


def payload(body):
    return SummaryInput(
        content_right_id=uuid.uuid4(),
        title="요약",
        body_version=2,
        body={"type": "doc", "content": body},
    )


def image(asset_id=None, **attrs):
    return {
        "type": "image",
        "attrs": {
            "asset_id": str(asset_id or uuid.uuid4()),
            "alt": "설명",
            "caption": "원문 이해 그림",
            "width_percent": 50,
            "align": "center",
            **attrs,
        },
    }


def paragraph(text="설명", marks=None):
    return {
        "type": "paragraph",
        "attrs": {"textAlign": "center"},
        "content": [
            {"type": "text", "text": text, **({"marks": marks} if marks else {})}
        ],
    }


def test_rich_roundtrip_preserves_image_row_table_typography_and_video():
    first, second = image(), image()
    nodes = [
        paragraph(
            marks=[
                {"type": "underline"},
                {"type": "highlight", "attrs": {"color": "#FFE8A3"}},
                {
                    "type": "textStyle",
                    "attrs": {"color": "#123456", "fontSize": "24px"},
                },
            ]
        ),
        {"type": "imageRow", "content": [first, second]},
        {
            "type": "table",
            "content": [
                {
                    "type": "tableRow",
                    "content": [
                        {
                            "type": "tableHeader",
                            "attrs": {"colspan": 1, "rowspan": 1, "colwidth": [180]},
                            "content": [paragraph("개념")],
                        },
                        {"type": "tableCell", "content": [paragraph("설명")]},
                    ],
                }
            ],
        },
        {"type": "youtube", "attrs": {"video_id": "abcdefghijk", "start_seconds": 30}},
    ]
    data = payload(nodes)
    restored = SummaryInput.model_validate_json(data.model_dump_json())
    assert restored.body == data.body
    assert document_asset_ids(data.body) == {
        uuid.UUID(first["attrs"]["asset_id"]),
        uuid.UUID(second["attrs"]["asset_id"]),
    }


@pytest.mark.parametrize(
    "node",
    [
        image(width_percent=0),
        image(align="absolute"),
        image(src="https://tracker.example/a.png"),
        image(asset_id="https://tracker.example/a.png"),
        {"type": "imageRow", "content": [image()]},
        {
            "type": "youtube",
            "attrs": {"video_id": "https://youtube.com/watch?v=abcdefghijk"},
        },
        {
            "type": "youtube",
            "attrs": {"video_id": "abcdefghijk", "src": "https://evil.example/embed"},
        },
        {"type": "youtube", "attrs": {"video_id": "abcdefghijk", "start_seconds": -1}},
        paragraph(marks=[{"type": "textStyle", "attrs": {"fontSize": "999px"}}]),
        paragraph(
            marks=[
                {"type": "textStyle", "attrs": {"color": "url(https://evil.example)"}}
            ]
        ),
        paragraph(
            marks=[{"type": "highlight", "attrs": {"color": "red;position:fixed"}}]
        ),
        {"type": "table", "content": [paragraph()]},
        {
            "type": "table",
            "content": [
                {
                    "type": "tableRow",
                    "content": [
                        {
                            "type": "tableCell",
                            "attrs": {"colspan": 0},
                            "content": [paragraph()],
                        }
                    ],
                }
            ],
        },
        {
            "type": "table",
            "content": [
                {
                    "type": "tableRow",
                    "content": [
                        {
                            "type": "tableCell",
                            "attrs": {"colspan": 1, "colwidth": ["100"]},
                            "content": [paragraph()],
                        }
                    ],
                }
            ],
        },
    ],
)
def test_untrusted_rich_content_is_rejected(node):
    with pytest.raises(ValidationError):
        payload([node])


@pytest.mark.asyncio
async def test_body_images_must_belong_to_unit(tmp_path):
    owned, foreign = uuid.uuid4(), uuid.uuid4()
    repo = AsyncMock()
    repo.assets.return_value = [SimpleNamespace(id=owned)]
    svc = SummaryService(repo, tmp_path)
    data = payload([image(foreign)])
    unit = SummaryUnit(content_right_id=data.content_right_id, slug="test", draft={})
    with pytest.raises(HTTPException) as error:
        await svc.check_assets(unit, data)
    assert error.value.status_code == 422
    data = payload([image(owned)])
    await svc.check_assets(unit, data)


@pytest.mark.asyncio
async def test_public_media_allows_published_body_only_and_denies_unused_draft(
    tmp_path,
):
    body_asset, carousel_asset, draft_asset = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    data = payload([image(body_asset)])
    data.slug = "test"
    data.position = 1
    data.slides = [SummarySlide(asset_id=carousel_asset, alt="캐러셀")]
    unit = SummaryUnit(
        content_right_id=data.content_right_id,
        slug="test",
        draft=data.model_dump(mode="json"),
    )
    revision = SummaryRevision(
        unit_id=unit.id, version=1, payload=data.model_dump(mode="json")
    )
    unit.published_revision_id = revision.id
    repo = AsyncMock()
    repo.get.return_value = unit
    repo.right.return_value = SimpleNamespace(status="allowed", scope_full_text=True)
    repo.revision.return_value = revision
    repo.assets.return_value = [
        SimpleNamespace(id=i, filename=f"{i}.png", mime_type="image/png")
        for i in [body_asset, carousel_asset, draft_asset]
    ]
    for asset in repo.assets.return_value:
        (tmp_path / asset.filename).write_bytes(b"published-test-file")
    svc = SummaryService(repo, tmp_path)
    await svc.media(unit.id, body_asset)
    await svc.media(unit.id, carousel_asset)
    with pytest.raises(HTTPException) as error:
        await svc.media(unit.id, draft_asset)
    assert error.value.status_code == 404
    repo.right.return_value.status = "withdrawn"
    with pytest.raises(HTTPException):
        await svc.media(unit.id, body_asset)


@pytest.mark.asyncio
async def test_upload_rejects_forged_image_header_before_persisting(tmp_path):
    repo = AsyncMock()
    repo.get.return_value = SummaryUnit(
        content_right_id=uuid.uuid4(), slug="test", draft={}
    )
    svc = SummaryService(repo, tmp_path)
    with pytest.raises(HTTPException) as error:
        await svc.upload(
            repo.get.return_value.id,
            b"\x89PNG\r\n\x1a\nforged",
            AsyncMock(),
            uuid.uuid4(),
        )
    assert error.value.status_code == 422
    repo.save.assert_not_awaited()
    assert not list(tmp_path.iterdir())


@pytest.mark.asyncio
async def test_create_cannot_reference_an_existing_units_body_image(tmp_path):
    repo = AsyncMock()
    repo.units.return_value = []
    repo.right.return_value = SimpleNamespace(id=uuid.uuid4())
    svc = SummaryService(repo, tmp_path)
    audit = AsyncMock()
    with pytest.raises(HTTPException) as error:
        await svc.create(payload([image()]), audit, uuid.uuid4())
    assert error.value.status_code == 422
    repo.save.assert_not_awaited()
    audit.log_audit.assert_not_awaited()
