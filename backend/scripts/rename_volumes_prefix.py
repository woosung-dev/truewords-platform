"""말씀선집 파일 중 '말씀선집 ' 접두어가 누락된 것을 일괄 rename.

옵션 A — 접두어만 추가, decoration(완료, 이성욱 등) 유지.

사용법:
    cd backend
    PYTHONPATH=. uv run python scripts/rename_volumes_prefix.py --dry-run
    PYTHONPATH=. uv run python scripts/rename_volumes_prefix.py --apply

동작:
    1. Qdrant + ingestion_jobs에서 대상 volume 식별
       (\\d+권 포함 + .pdf + '말씀선집'으로 시작하지 않음)
    2. new_name = '말씀선집 ' + old_name
    3. 충돌 검사: new_name이 이미 존재하면 skip (경고)
    4. --apply 시:
       - Qdrant: scroll → set_payload(volume=new, title=new) (NFC/NFD 둘 다 검색)
       - PostgreSQL: ingestion_jobs.volume_key / filename 업데이트
"""

import argparse
import asyncio
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from qdrant_client.models import FieldCondition, Filter, MatchAny
from sqlalchemy import select, update

from src.common.database import async_session_factory
from src.config import settings
from src.pipeline.ingestion_models import IngestionJob
from src.qdrant_client import get_client


PATTERN = re.compile(r"\d+권")  # 번호+권 포함 여부


def needs_rename(name: str) -> bool:
    nfc = unicodedata.normalize("NFC", name)
    if not nfc.endswith(".pdf"):
        return False
    if nfc.startswith("말씀선집"):
        return False
    return bool(PATTERN.search(nfc))


def get_all_qdrant_volumes() -> dict[str, int]:
    """{volume_name_as_stored: point_count} 반환."""
    client = get_client()
    volumes: dict[str, int] = {}
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=settings.collection_name,
            with_payload=["volume"],
            with_vectors=False,
            limit=1000,
            offset=offset,
        )
        if not points:
            break
        for p in points:
            vol = (p.payload or {}).get("volume", "")
            if vol:
                volumes[vol] = volumes.get(vol, 0) + 1
        if offset is None:
            break
    return volumes


def rename_qdrant_points(old_name: str, new_name: str) -> int:
    """old_name (NFC/NFD 둘 다) → new_name으로 payload 갱신. 청크 수 반환."""
    client = get_client()
    search_terms = list({
        unicodedata.normalize("NFC", old_name),
        unicodedata.normalize("NFD", old_name),
    })

    point_ids: list = []
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=settings.collection_name,
            scroll_filter=Filter(
                must=[FieldCondition(key="volume", match=MatchAny(any=search_terms))]
            ),
            with_payload=["volume"],
            with_vectors=False,
            limit=1000,
            offset=offset,
        )
        if not points:
            break
        for p in points:
            point_ids.append(p.id)
        if offset is None:
            break

    if not point_ids:
        return 0

    # 일관된 NFC로 저장
    new_name_nfc = unicodedata.normalize("NFC", new_name)
    client.set_payload(
        collection_name=settings.collection_name,
        payload={"volume": new_name_nfc, "title": new_name_nfc},
        points=point_ids,
    )
    return len(point_ids)


async def update_ingestion_jobs(old_name: str, new_name: str) -> int:
    """ingestion_jobs.volume_key / filename 갱신. 영향받은 row 수 반환."""
    old_nfc = unicodedata.normalize("NFC", old_name)
    new_nfc = unicodedata.normalize("NFC", new_name)
    async with async_session_factory() as session:
        stmt = select(IngestionJob).where(IngestionJob.volume_key == old_nfc)
        job = (await session.execute(stmt)).scalar_one_or_none()
        if job is None:
            return 0
        # 충돌 체크
        new_exists_stmt = select(IngestionJob).where(IngestionJob.volume_key == new_nfc)
        if (await session.execute(new_exists_stmt)).scalar_one_or_none():
            print(f"  ⚠️  ingestion_jobs에 new_name={new_nfc} 이미 존재, DB 갱신 skip")
            return 0
        await session.execute(
            update(IngestionJob)
            .where(IngestionJob.id == job.id)
            .values(volume_key=new_nfc, filename=new_nfc)
        )
        await session.commit()
        return 1


async def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    print("🔍 Qdrant 집계 중...")
    all_volumes = get_all_qdrant_volumes()
    existing_nfc = {unicodedata.normalize("NFC", v) for v in all_volumes}

    # rename 대상 수집 (NFC 기준)
    candidates: dict[str, str] = {}  # old → new
    for raw, _count in all_volumes.items():
        nfc = unicodedata.normalize("NFC", raw)
        if needs_rename(nfc):
            new_name = "말씀선집 " + nfc
            candidates[raw] = new_name

    if not candidates:
        print("대상 없음.")
        return

    # 충돌 검사: new_name이 이미 존재하는 경우
    conflicts: list[tuple[str, str]] = []
    safe: list[tuple[str, str]] = []
    for old, new in sorted(candidates.items()):
        if unicodedata.normalize("NFC", new) in existing_nfc:
            conflicts.append((old, new))
        else:
            safe.append((old, new))

    print(f"\n📦 대상 총 {len(candidates)}개 — 안전 {len(safe)} / 충돌 {len(conflicts)}\n")

    if conflicts:
        print("=== ⚠️ 충돌 (new_name이 이미 존재 — skip) ===")
        for old, new in conflicts:
            print(f"  {old}  →  {new}")
        print()

    print(f"=== ✅ rename 대상 ({len(safe)}개) ===")
    for old, new in safe[:10]:
        print(f"  {old}")
        print(f"    → {new}")
    if len(safe) > 10:
        print(f"  ... 외 {len(safe)-10}개")

    if args.dry_run:
        print("\n--dry-run 모드. 실제 실행은 --apply 플래그.")
        return

    print(f"\n🚀 실제 rename 실행 ({len(safe)}개)...")
    total_chunks = 0
    total_rows = 0
    for i, (old, new) in enumerate(safe, 1):
        chunks = rename_qdrant_points(old, new)
        rows = await update_ingestion_jobs(old, new)
        total_chunks += chunks
        total_rows += rows
        if i % 10 == 0 or i == len(safe):
            print(f"  [{i}/{len(safe)}] ...")

    print(f"\n✅ 완료: Qdrant {total_chunks}청크 갱신, ingestion_jobs {total_rows}행 갱신")


if __name__ == "__main__":
    asyncio.run(main())
