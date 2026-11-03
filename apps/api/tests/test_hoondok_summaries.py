"""공개 스냅샷·권리 철회·편집 충돌과 Tiptap 신뢰 경계."""

import uuid
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.modules.hoondok.models import ContentRight
from app.modules.hoondok.summary_models import SummaryUnit, SummaryRevision
from app.modules.hoondok.summary_schemas import (
    SummaryInput,
    SummaryUpdate,
    SummaryActionInput,
)
from app.modules.hoondok.summary_service import SummaryService


def setup():
    right = ContentRight(
        volume="book", work_title="책", status="allowed", scope_full_text=True
    )
    data = SummaryInput(
        content_right_id=right.id,
        slug="unit-1",
        position=1,
        title="초안 제목",
        lead="소개",
        key_points=["정리"],
        body={
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "해설"}]}
            ],
        },
    )
    unit = SummaryUnit(
        content_right_id=right.id, slug=data.slug, draft=data.model_dump(mode="json")
    )
    repo = AsyncMock()
    repo.get.return_value = unit
    repo.right.return_value = right
    repo.assets.return_value = []
    repo.units.return_value = [unit]
    svc = SummaryService(repo, "/tmp/summary-test")
    return svc, repo, unit, data, right


def test_rejects_unsafe_html_and_links():
    for body in [
        {"type": "html"},
        {
            "type": "doc",
            "content": [
                {
                    "type": "text",
                    "text": "bad",
                    "marks": [
                        {"type": "link", "attrs": {"href": "javascript:alert(1)"}}
                    ],
                }
            ],
        },
    ]:
        with pytest.raises(ValidationError):
            SummaryInput(
                content_right_id=uuid.uuid4(),
                slug="test",
                position=1,
                title="제목",
                body=body,
            )


@pytest.mark.asyncio
async def test_draft_body_and_media_not_public():
    svc, repo, unit, data, right = setup()
    assert (await svc.list_public())[0].lead == ""
    with pytest.raises(HTTPException) as err:
        await svc.detail(unit.id)
    assert err.value.status_code == 404
    with pytest.raises(HTTPException):
        await svc.media(unit.id, uuid.uuid4())


@pytest.mark.asyncio
async def test_edit_keeps_published_snapshot_and_resets_approval():
    svc, repo, unit, data, right = setup()
    payload = data.model_dump(mode="json")
    payload["title"] = "공개 제목"
    revision = SummaryRevision(unit_id=unit.id, version=1, payload=payload)
    unit.published_revision_id = revision.id
    unit.review_status = "approved"
    repo.revision.return_value = revision
    update = SummaryUpdate(**data.model_dump(), version=1)
    await svc.update(unit.id, update, AsyncMock(), uuid.uuid4())
    assert unit.review_status == "draft"
    assert unit.version == 2
    assert (await svc.list_public())[0].title == "공개 제목"
    right.status = "withdrawn"
    assert await svc.list_public() == []
    with pytest.raises(HTTPException):
        await svc.published(unit.id)


@pytest.mark.asyncio
async def test_review_transitions_and_stale_save():
    svc, repo, unit, data, right = setup()
    with pytest.raises(HTTPException) as err:
        await svc.action(
            unit.id,
            SummaryActionInput(action="publish", version=1),
            AsyncMock(),
            uuid.uuid4(),
        )
    assert err.value.status_code == 409
    await svc.action(
        unit.id,
        SummaryActionInput(action="request_review", version=1),
        AsyncMock(),
        uuid.uuid4(),
    )
    assert unit.review_status == "in_review"
    with pytest.raises(HTTPException) as err:
        await svc.update(
            unit.id,
            SummaryUpdate(**data.model_dump(), version=1),
            AsyncMock(),
            uuid.uuid4(),
        )
    assert err.value.status_code == 409


@pytest.mark.parametrize(
    "node",
    [
        {"type": "doc", "content": "bad"},
        {"type": "doc", "content": [{"type": "paragraph", "attrs": [1]}]},
        {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "t", "marks": [None]}],
                }
            ],
        },
        {"type": "doc", "content": [{"type": "doc"}]},
        {"type": "doc", "content": [{"type": "text", "text": "root-inline"}]},
        {
            "type": "doc",
            "content": [{"type": "bulletList", "content": [{"type": "paragraph"}]}],
        },
    ],
)
def test_malformed_document_is_validation_error(node):
    with pytest.raises(ValidationError):
        SummaryInput(
            content_right_id=uuid.uuid4(),
            slug="test",
            position=1,
            title="제목",
            body=node,
        )


@pytest.mark.asyncio
async def test_source_validation_requires_exact_volume_and_snapshot():
    from app.modules.qdrant import QdrantPoint

    svc, repo, unit, data, right = setup()
    chunk_id = str(uuid.uuid4())
    data.source = data.source.model_copy(
        update={"text": "원문", "chunk_ids": [chunk_id]}
    )
    svc.source_client = AsyncMock()
    svc.source_client.retrieve.return_value = [
        QdrantPoint(
            id=chunk_id,
            score=0,
            payload={"text": "원문 내용", "volume": "other", "chunk_index": 0},
        )
    ]
    with pytest.raises(HTTPException) as error:
        await svc.verify_source(data)
    assert error.value.status_code == 422
    svc.source_client.retrieve.return_value = [
        QdrantPoint(
            id=chunk_id,
            score=0,
            payload={"text": "원문 내용", "volume": "book", "chunk_index": 0},
        )
    ]
    await svc.verify_source(data)
    data.source.text = "원문에 없는 문장"
    with pytest.raises(HTTPException):
        await svc.verify_source(data)


def test_admin_endpoints_require_authentication_and_csrf():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.modules.admin.dependencies import get_current_admin, require_admin_gate

    client = TestClient(app, follow_redirects=False)
    assert client.get("/admin/hoondok/ai-summaries").status_code == 401
    app.dependency_overrides[get_current_admin] = lambda: {"user_id": uuid.uuid4()}
    app.dependency_overrides[require_admin_gate] = lambda: {}
    try:
        assert client.post("/admin/hoondok/ai-summaries", json={}).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
        app.dependency_overrides.pop(require_admin_gate, None)


@pytest.mark.asyncio
async def test_complete_review_publish_edit_and_withdraw_cycle():
    from types import SimpleNamespace
    from app.modules.hoondok.summary_schemas import SummarySource, SummarySlide

    svc, repo, unit, data, right = setup()
    data.source = SummarySource(
        edition="판본",
        locator="1절",
        text="원문",
        chunk_ids=[str(uuid.uuid4())],
        verified=True,
        note="내부 검수 메모",
    )
    assets = [
        SimpleNamespace(id=uuid.uuid4(), mime_type="image/png"),
        SimpleNamespace(id=uuid.uuid4(), mime_type="image/png"),
    ]
    data.slides = [
        SummarySlide(asset_id=a.id, alt="설명 그림", caption="캡션") for a in assets
    ]
    unit.draft = data.model_dump(mode="json")
    repo.assets.return_value = assets
    revisions = {}

    async def save(row):
        if isinstance(row, SummaryRevision):
            revisions[row.id] = row
        return row

    async def revision(revision_id):
        return revisions.get(revision_id)

    repo.save.side_effect = save
    repo.revision.side_effect = revision
    svc.verify_source = AsyncMock()
    audit = AsyncMock()
    actor = uuid.uuid4()
    for action in ["request_review", "approve", "publish"]:
        await svc.action(
            unit.id,
            SummaryActionInput(action=action, version=unit.version),
            audit,
            actor,
        )
    detail = await svc.detail(unit.id)
    assert detail.title == data.title
    assert detail.source.note == ""
    assert len(detail.slides) == 2
    data.title = "새 초안 제목"
    await svc.update(
        unit.id, SummaryUpdate(**data.model_dump(), version=unit.version), audit, actor
    )
    assert (await svc.detail(unit.id)).title != data.title
    await svc.action(
        unit.id,
        SummaryActionInput(action="withdraw", version=unit.version),
        audit,
        actor,
    )
    with pytest.raises(HTTPException) as error:
        await svc.detail(unit.id)
    assert error.value.status_code == 404
    assert audit.log_audit.await_count == 5


@pytest.mark.asyncio
async def test_reversed_source_ids_cannot_publish_wrong_reader_start():
    from app.modules.qdrant import QdrantPoint
    from app.modules.hoondok.summary_schemas import SummarySource

    svc, repo, unit, data, right = setup()
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    data.source = SummarySource(text="첫 단락 둘째 단락", chunk_ids=[second, first])
    svc.source_client = AsyncMock()
    svc.source_client.retrieve.return_value = [
        QdrantPoint(
            id=second,
            score=0,
            payload={"text": "둘째 단락", "volume": "book", "chunk_index": 1},
        ),
        QdrantPoint(
            id=first,
            score=0,
            payload={"text": "첫 단락", "volume": "book", "chunk_index": 0},
        ),
    ]
    with pytest.raises(HTTPException) as error:
        await svc.verify_source(data)
    assert error.value.status_code == 422
    assert "읽기 순서" in error.value.detail
