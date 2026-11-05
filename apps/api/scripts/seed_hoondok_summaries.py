"""격리 E2E 전용 AI 요약 fixture. content/ai-summaries 의 천성경 절 콘텐츠·그림을 그대로 쓴다.

- cheon-01-01-01: 공개본(웹 상세 검증)
- cheon-01-01-02: 초안(웹에 보이면 안 된다)
- cheon-01-01-03: 초안(관리자 상태 전환 검증 — 그림·원문 위치를 갖춰 공개 검사를 통과한다)
다시 실행하면 세 절을 처음 상태로 되돌린다.
"""

import asyncio
import json
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete
from sqlmodel import select

from app.core.common.database import async_session_factory, init_db
from app.core.config import settings
from app.modules.hoondok.models import ContentRight
from app.modules.hoondok.summary_models import SummaryAsset, SummaryRevision, SummaryUnit
from app.modules.hoondok.summary_schemas import SummaryInput

CONTENT = Path(__file__).resolve().parent.parent / "content/ai-summaries"
WORK_TITLE = "천성경"
VOLUME = "천성경 E2E"
PUBLISHED = {"cheon-01-01-01"}
SLUGS = ["cheon-01-01-01", "cheon-01-01-02", "cheon-01-01-03"]


async def seed() -> None:
    database_url = urlparse(settings.database_url.get_secret_value())
    if (
        settings.environment != "development"
        or database_url.hostname not in {"localhost", "127.0.0.1"}
        or database_url.port != 15432
        or database_url.path != "/truewords_e2e"
    ):
        raise SystemExit("격리 truewords_e2e DB에서만 실행할 수 있습니다")
    await init_db()
    entries = {e["slug"]: e for e in json.loads((CONTENT / "manifest.json").read_text())}
    media_dir = Path(settings.hoondok_summary_media_dir)
    media_dir.mkdir(parents=True, exist_ok=True)
    async with async_session_factory() as session:
        right = (
            await session.execute(select(ContentRight).where(ContentRight.volume == VOLUME))
        ).scalar_one_or_none() or ContentRight(volume=VOLUME)
        right.work_title = WORK_TITLE
        right.status = "allowed"
        right.scope_full_text = True
        right.source_keys = ["O"]
        right.book_series = "cheonseong_gyeong"
        right.chunk_count = 0
        right.note = "E2E AI 요약 fixture 전용 권리"
        session.add(right)
        await session.flush()
        for slug in SLUGS:
            entry = entries[slug]
            unit_id = uuid.uuid5(uuid.NAMESPACE_URL, "truewords:summary:" + slug)
            unit = await session.get(SummaryUnit, unit_id)
            if unit is not None:
                unit.published_revision_id = None
                await session.flush()
                await session.execute(delete(SummaryRevision).where(SummaryRevision.unit_id == unit_id))
                await session.execute(delete(SummaryAsset).where(SummaryAsset.unit_id == unit_id))
                await session.flush()
            assets = []
            images = []
            for number, image in enumerate(entry["images"]):
                asset_id = uuid.uuid5(unit_id, str(number))
                filename = f"{asset_id}.webp"
                (media_dir / filename).write_bytes((CONTENT / image["file"]).read_bytes())
                assets.append(SummaryAsset(id=asset_id, unit_id=unit_id, mime_type="image/webp", filename=filename))
                images.append(
                    {
                        "kind": image["kind"],
                        "asset_id": str(asset_id),
                        "alt": image["alt"],
                        "caption": image.get("caption", ""),
                    }
                )
            payload = {k: v for k, v in entry.items() if k not in {"work_title", "images"}}
            payload["content_right_id"] = right.id
            payload["images"] = images
            draft = SummaryInput.model_validate(payload).model_dump(mode="json")
            if unit is None:
                unit = SummaryUnit(id=unit_id, content_right_id=right.id, slug=slug, draft=draft)
            unit.draft = draft
            unit.version = 1
            unit.review_status = "published" if slug in PUBLISHED else "draft"
            session.add(unit)
            await session.flush()
            for asset in assets:
                session.add(asset)
            await session.flush()
            if slug in PUBLISHED:
                revision = SummaryRevision(unit_id=unit_id, version=1, payload=draft)
                session.add(revision)
                await session.flush()
                unit.published_revision_id = revision.id
        await session.commit()
    print(f"AI 요약 fixture: 공개 {len(PUBLISHED)} · 초안 {len(SLUGS) - len(PUBLISHED)}")


if __name__ == "__main__":
    asyncio.run(seed())
