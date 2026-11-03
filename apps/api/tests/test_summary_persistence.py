"""실제 SQLite 저장·HTTP 공개 흐름과 초안 임포트 원자성 검증."""

import argparse
import base64
import importlib.util
import json
import uuid
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select

from app.main import app
from app.modules.admin.dependencies import (
    get_current_admin,
    get_admin_service,
    require_admin_gate,
)
from app.modules.admin.models import AdminAuditLog
from app.modules.admin.repository import AdminRepository
from app.modules.admin.service import AdminService
from app.modules.hoondok.models import ContentRight
from app.modules.hoondok.summary_models import (
    SummaryUnit,
    SummaryRevision,
    SummaryAsset,
)
from app.modules.hoondok.summary_repository import SummaryRepository
from app.modules.hoondok.summary_router import service
from app.modules.hoondok.summary_service import SummaryService
from app.modules.qdrant import QdrantPoint

MANIFEST = Path(__file__).parents[1] / "content/ai-summaries/manifest.json"
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
)


@pytest.fixture
async def database(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/summary.db")
    async with engine.begin() as connection:
        await connection.run_sync(
            SQLModel.metadata.create_all,
            tables=[
                ContentRight.__table__,
                SummaryUnit.__table__,
                SummaryRevision.__table__,
                SummaryAsset.__table__,
                AdminAuditLog.__table__,
            ],
        )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        rights = [
            ContentRight(
                work_title=name, volume=name, status="allowed", scope_full_text=True
            )
            for name in ["원리강론", "천성경"]
        ]
        session.add_all(rights)
        await session.commit()
    yield factory, rights
    await engine.dispose()


@pytest.mark.asyncio
async def test_persistent_admin_to_public_lifecycle(database, tmp_path):
    factory, rights = database
    async with factory() as session:
        chunk_id = str(uuid.uuid4())
        source = AsyncMock()
        source.retrieve.return_value = [
            QdrantPoint(
                id=chunk_id,
                score=0,
                payload={
                    "volume": rights[0].volume,
                    "text": "연결된 원문입니다.",
                    "chunk_index": 0,
                },
            )
        ]
        svc = SummaryService(SummaryRepository(session), tmp_path / "media", source)
        app.dependency_overrides[service] = lambda: svc
        app.dependency_overrides[get_current_admin] = lambda: {
            "user_id": uuid.UUID(int=1)
        }
        app.dependency_overrides[require_admin_gate] = lambda: {}
        app.dependency_overrides[get_admin_service] = lambda: AdminService(
            AdminRepository(session)
        )
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
                headers={"X-Requested-With": "XMLHttpRequest"},
            ) as client:
                payload = dict(
                    content_right_id=str(rights[0].id),
                    slug="persistent",
                    position=1,
                    title="공개 제목",
                    lead="소개",
                    key_points=["핵심"],
                    body={
                        "type": "doc",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "해설"}],
                            }
                        ],
                    },
                    source={
                        "text": "연결된 원문입니다.",
                        "edition": "검수 판본",
                        "locator": "첫 단락",
                        "chunk_ids": [chunk_id],
                        "verified": True,
                        "note": "내부 메모",
                    },
                )
                result = await client.post("/admin/hoondok/ai-summaries", json=payload)
                assert result.status_code == 201, result.text
                item = result.json()
                base = "/admin/hoondok/ai-summaries/" + item["id"]
                public = "/hoondok/ai-summaries/" + item["id"]
                assert (await client.get(public)).status_code == 404
                slides = []
                for i in range(2):
                    uploaded = await client.post(
                        base + "/media", files={"file": (f"{i}.png", PNG, "image/png")}
                    )
                    assert uploaded.status_code == 201, uploaded.text
                    asset = uploaded.json()
                    slides.append(
                        {
                            "asset_id": asset["id"],
                            "alt": f"그림 {i}",
                            "caption": "원문 이해 그림",
                        }
                    )
                    assert (
                        await client.get(public + "/media/" + asset["id"])
                    ).status_code == 404
                payload.update(slides=slides, version=item["version"])
                updated = await client.put(base, json=payload)
                assert updated.status_code == 200, updated.text
                item = updated.json()
                for action in ["request_review", "approve", "publish"]:
                    result = await client.post(
                        base + "/actions",
                        json={"action": action, "version": item["version"]},
                    )
                    assert result.status_code == 200, result.text
                    item = result.json()
                published = await client.get(public)
                assert published.status_code == 200, published.text
                assert published.json()["source"]["note"] == ""
                image = await client.get(public + "/media/" + slides[0]["asset_id"])
                assert image.status_code == 200 and image.content == PNG
                assert "no-store" in image.headers["cache-control"]
                stale = await client.put(base, json=payload)
                assert stale.status_code == 409
                payload.update(title="새 작업본", version=item["version"])
                saved = (await client.put(base, json=payload)).json()
                assert (await client.get(public)).json()["title"] == "공개 제목"
                for right in rights:
                    stored = await session.get(ContentRight, right.id)
                    stored.status = "withdrawn"
                await session.commit()
                assert (await client.get(public)).status_code == 404
                assert (await client.get(public + "/source")).status_code == 404
                assert (
                    await client.get(public + "/media/" + slides[0]["asset_id"])
                ).status_code == 404
                result = await client.post(
                    base + "/actions",
                    json={"action": "withdraw", "version": saved["version"]},
                )
                assert result.status_code == 200, result.text
                assert (
                    len((await session.execute(select(AdminAuditLog))).scalars().all())
                    == 9
                )
        finally:
            for provider in [
                service,
                get_current_admin,
                require_admin_gate,
                get_admin_service,
            ]:
                app.dependency_overrides.pop(provider, None)
    async with factory() as fresh:
        unit = (await fresh.execute(select(SummaryUnit))).scalar_one()
        assert unit.published_revision_id is None
        assert unit.draft["title"] == "새 작업본"
        assert len((await fresh.execute(select(SummaryRevision))).scalars().all()) == 1


def load_importer():
    spec = importlib.util.spec_from_file_location(
        "summary_importer", Path(__file__).parents[1] / "scripts/import_ai_summaries.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_content_import_is_private_valid_and_idempotent(
    database, tmp_path, monkeypatch
):
    factory, rights = database
    module = load_importer()
    monkeypatch.setattr(module, "async_session_factory", factory)
    monkeypatch.setattr(
        module.settings, "hoondok_summary_media_dir", str(tmp_path / "media")
    )
    mapping = tmp_path / "rights.json"
    mapping.write_text(json.dumps({r.work_title: str(r.id) for r in rights}))
    args = argparse.Namespace(
        manifest=str(MANIFEST), rights_map=str(mapping), dry_run=True
    )
    await module.run(args)
    assert not (tmp_path / "media").exists()
    args.dry_run = False
    await module.run(args)
    await module.run(args)
    async with factory() as session:
        units = (await session.execute(select(SummaryUnit))).scalars().all()
        assets = (await session.execute(select(SummaryAsset))).scalars().all()
        assert len(units) == 3 and len(assets) == 9
        assert len({u.slug for u in units}) == 3
        for unit in units:
            assert unit.published_revision_id is None
            assert unit.review_status == "draft"
            assert unit.draft["source"]["verified"] is False
            assert unit.draft["source"]["chunk_ids"] == []
            assert len(unit.draft["source"]["sha256"]) == 64
            assert len(unit.draft["slides"]) == 3
        assert len(list((tmp_path / "media").iterdir())) == 9


@pytest.mark.asyncio
async def test_import_copy_failure_rolls_back_files_and_database(
    database, tmp_path, monkeypatch
):
    factory, rights = database
    module = load_importer()
    monkeypatch.setattr(module, "async_session_factory", factory)
    media = tmp_path / "media"
    monkeypatch.setattr(module.settings, "hoondok_summary_media_dir", str(media))
    mapping = tmp_path / "rights.json"
    mapping.write_text(json.dumps({r.work_title: str(r.id) for r in rights}))
    original = Path.write_bytes
    count = 0

    def broken_write(path, data):
        nonlocal count
        if path.parent == media:
            count += 1
            if count == 2:
                original(path, data[:10])
                raise OSError("simulated disk full")
        return original(path, data)

    monkeypatch.setattr(Path, "write_bytes", broken_write)
    with pytest.raises(OSError, match="disk full"):
        await module.run(
            argparse.Namespace(
                manifest=str(MANIFEST), rights_map=str(mapping), dry_run=False
            )
        )
    async with factory() as session:
        assert not (await session.execute(select(SummaryUnit))).scalars().all()
        assert not (await session.execute(select(SummaryAsset))).scalars().all()
    assert not list(media.iterdir())
