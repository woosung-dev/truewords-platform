"""격리된 편집 개발 DB에 제공 원문을 적재한다. 임베딩·LLM 호출 없음."""

import argparse, asyncio, json, sys, uuid
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from qdrant_client import AsyncQdrantClient, models
from sqlmodel import select
from app.core.config import settings
from app.core.common.database import async_session_factory
from app.modules.admin.auth import hash_password
from app.modules.admin.models import AdminUser, AdminRole
from app.modules.hoondok.models import ContentRight, VolumeSection
from app.modules.hoondok.section_rules import extract_sections
from app.modules.pipeline.chunker import chunk_recursive


async def main(evidence):
    db = urlsplit(settings.database_url.get_secret_value())
    if (
        settings.environment != "development"
        or db.hostname != "127.0.0.1"
        or db.port != 15482
        or settings.qdrant_url != "http://127.0.0.1:16483"
        or settings.collection_name != "hoondok_158e_editor_dev"
    ):
        raise SystemExit("전용 로컬 개발 환경에서만 실행하세요")
    q = AsyncQdrantClient(url=settings.qdrant_url)
    if not await q.collection_exists(settings.collection_name):
        await q.create_collection(settings.collection_name, vectors_config={})
    rights = {}
    async with async_session_factory() as s:
        cred = json.loads(Path("var/editor-dev/credentials.json").read_text())
        if not (
            await s.execute(select(AdminUser).where(AdminUser.email == cred["email"]))
        ).scalar_one_or_none():
            s.add(
                AdminUser(
                    email=cred["email"],
                    hashed_password=hash_password(cred["password"]),
                    role=AdminRole.SUPER_ADMIN,
                )
            )
        for key, title, series in [
            ("cheon", "천성경", "cheonseong_gyeong"),
        ]:
            text = "\n\n".join(
                l.split("\t", 1)[1]
                for l in (Path(evidence) / (key + ".txt")).read_text().splitlines()
            )
            volume = title + " · 로컬 제공본"
            cs = chunk_recursive(text, volume, source=["O"])
            ps = [
                models.PointStruct(
                    id=str(
                        uuid.uuid5(
                            uuid.NAMESPACE_URL, f"editor-dev:{key}:{c.chunk_index}"
                        )
                    ),
                    vector={},
                    payload={
                        "text": c.text,
                        "volume": volume,
                        "chunk_index": c.chunk_index,
                        "source": ["O"],
                        "title": title,
                        "book_series": series,
                    },
                )
                for c in cs
            ]
            for i in range(0, len(ps), 100):
                await q.upsert(settings.collection_name, ps[i : i + 100], wait=True)
            r = (
                await s.execute(
                    select(ContentRight).where(ContentRight.volume == volume)
                )
            ).scalar_one_or_none()
            if not r:
                r = ContentRight(
                    volume=volume,
                    work_title=title,
                    status="allowed",
                    scope_full_text=True,
                    source_keys=["O"],
                    book_series=series,
                    chunk_count=len(cs),
                    note="로컬 편집용 제공본 · 운영 판본 검수와 별개",
                )
                s.add(r)
                await s.flush()
            rights[title] = str(r.id)
            if not (
                await s.execute(
                    select(VolumeSection).where(VolumeSection.volume == volume)
                )
            ).first():
                for section in extract_sections(
                    series, [(c.chunk_index, c.text) for c in cs]
                ):
                    s.add(VolumeSection(volume=volume, origin="auto", **section))
            print(title, len(cs), "조각 적재")
        await s.commit()
    await q.close()
    Path("var/editor-dev/rights.json").write_text(
        json.dumps(rights, ensure_ascii=False, indent=2) + "\n"
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--evidence", required=True)
    asyncio.run(main(p.parse_args().evidence))
