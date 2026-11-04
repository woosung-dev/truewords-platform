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
                    evidence=[{"claim": "근거 문장", "from": 1, "to": 2}],
                    reflection_questions=["되새길 물음"],
                    uncertainty=["관리자 전용 확인 사항"],
                    generation={"text_model": "비공개-모델", "text_score": 90},
                )
                result = await client.post("/admin/hoondok/ai-summaries", json=payload)
                assert result.status_code == 201, result.text
                item = result.json()
                base = "/admin/hoondok/ai-summaries/" + item["id"]
                public = "/hoondok/ai-summaries/" + item["id"]
                assert (await client.get(public)).status_code == 404
                slides = []
                for i, kind in enumerate(["concept", "scene"]):
                    uploaded = await client.post(
                        base + "/media", files={"file": (f"{i}.png", PNG, "image/png")}
                    )
                    assert uploaded.status_code == 201, uploaded.text
                    asset = uploaded.json()
                    slides.append(
                        {
                            "kind": kind,
                            "asset_id": asset["id"],
                            "alt": f"그림 {i}",
                            "caption": "원문 이해 그림",
                        }
                    )
                    assert (
                        await client.get(public + "/media/" + asset["id"])
                    ).status_code == 404
                payload.update(images=slides, version=item["version"])
                updated = await client.put(base, json=payload)
                assert updated.status_code == 200, updated.text
                item = updated.json()
                for action in ["request_review", "publish"]:
                    result = await client.post(
                        base + "/actions",
                        json={"action": action, "version": item["version"]},
                    )
                    assert result.status_code == 200, result.text
                    item = result.json()
                    assert item["review_status"] == item["review_status"].lower()
                assert item["review_status"] == "published"
                published = await client.get(public)
                assert published.status_code == 200, published.text
                # 공개 응답에는 관리자 전용 필드가 없다.
                for secret in ["uncertainty", "generation", "note", "verified"]:
                    assert secret not in published.json()
                    assert secret not in published.json()["source"]
                assert "비공개-모델" not in published.text
                assert "관리자 전용" not in published.text
                assert published.json()["evidence"] == [
                    {
                        "claim": "근거 문장",
                        "from": 1,
                        "to": 2,
                        "chunk_index": None,
                        "chunk_id": None,
                    }
                ]
                listed = await client.get("/hoondok/ai-summaries")
                assert "관리자 전용" not in listed.text
                assert [i["id"] for i in listed.json()] == [item["id"]]
                admin = (await client.get(base)).json()
                assert admin["uncertainty"] == ["관리자 전용 확인 사항"]
                assert admin["generation"]["text_model"] == "비공개-모델"
                toc = await client.get(
                    "/admin/hoondok/ai-summaries/cheonseong-toc?status=published"
                )
                assert toc.status_code == 200, toc.text
                assert toc.json() == []
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
                    == 8
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


def content_entry(slug):
    """CONTENT_SCHEMA 계약의 천성경 절 콘텐츠 — 원문 전문 없음."""
    return {
        "slug": slug,
        "work_title": "천성경",
        "group_title": "제1편 하나님 · 제1장 하나님의 존재와 속성 · 1절 하나님의 실존",
        "position": int(slug[-2:]),
        "title": "하나님의 실존",
        "lead": "핵심 한 줄",
        "key_points": ["요점1", "요점2", "요점3"],
        "body": {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 2},
                    "content": [{"type": "text", "text": "소제목"}],
                },
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "해설 (말씀 5–7)"}],
                },
            ],
        },
        "evidence": [{"claim": "한 문장", "from": 5, "to": 7}],
        "reflection_questions": ["되새길 물음"],
        "uncertainty": ["확인 필요"],
        "images": [
            {"kind": kind, "file": f"images/{slug}-{kind}.png", "alt": kind, "caption": "AI가 만든 설명용 이미지"}
            for kind in ["concept", "scene"]
        ],
        "source": {
            "edition": "천성경 증보판 제공 DOCX",
            "locator": "제1편 1장 1절 말씀 1–43",
            "sha256": "d" * 64,
            "paragraph_from": 1,
            "paragraph_to": 43,
        },
        "generation": {
            "text_model": "test-model",
            "text_score": 87,
            "text_rounds": 2,
            "image_scores": {"concept": 80, "scene": 82},
            "image_rounds": {"concept": 1, "scene": 1},
        },
    }


def fixture_manifest(tmp_path):
    folder = tmp_path / "content"
    (folder / "images").mkdir(parents=True, exist_ok=True)
    entries = [content_entry("cheon-01-01-01"), content_entry("cheon-01-01-02")]
    for entry in entries:
        for image in entry["images"]:
            (folder / image["file"]).write_bytes(PNG)
    path = folder / "manifest.json"
    path.write_text(json.dumps(entries, ensure_ascii=False))
    return path


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
        manifest=str(fixture_manifest(tmp_path)), rights_map=str(mapping), dry_run=True
    )
    await module.run(args)
    assert not (tmp_path / "media").exists()
    args.dry_run = False
    await module.run(args)
    await module.run(args)
    async with factory() as session:
        units = (await session.execute(select(SummaryUnit))).scalars().all()
        assets = (await session.execute(select(SummaryAsset))).scalars().all()
        assert len(units) == 2 and len(assets) == 4
        assert len({u.slug for u in units}) == 2
        for unit in units:
            assert unit.published_revision_id is None
            assert unit.review_status == "draft"
            assert unit.draft["source"]["verified"] is False
            assert unit.draft["source"]["chunk_ids"] == []
            assert unit.draft["source"]["text"] == ""
            assert unit.draft["source"]["sha256"] == "d" * 64
            assert unit.draft["source"]["paragraph_to"] == 43
            assert [i["kind"] for i in unit.draft["images"]] == ["concept", "scene"]
            assert unit.draft["evidence"][0]["from"] == 5
            assert unit.draft["uncertainty"] == ["확인 필요"]
            assert unit.draft["generation"]["text_score"] == 87
        assert len(list((tmp_path / "media").iterdir())) == 4


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
                manifest=str(fixture_manifest(tmp_path)),
                rights_map=str(mapping),
                dry_run=False,
            )
        )
    async with factory() as session:
        assert not (await session.execute(select(SummaryUnit))).scalars().all()
        assert not (await session.execute(select(SummaryAsset))).scalars().all()
    assert not list(media.iterdir())
