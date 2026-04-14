"""Qdrant에 이미 적재된 volume들을 ingestion_jobs 테이블에 COMPLETED 상태로 백필.

progress.json 제거로 소실된 처리 이력을 Qdrant 실제 데이터 기준으로 재생성한다.
일회성 마이그레이션 스크립트.

사용법:
    cd backend
    PYTHONPATH=. uv run python scripts/backfill_ingestion_jobs.py [--dry-run]

동작:
    1. Qdrant scroll로 전체 포인트 훑어 volume별 청크 수/소스/제목 집계
    2. 각 volume에 대해 ingestion_jobs UPSERT (status=COMPLETED, total/processed=count)
    3. 이미 존재하는 row는 건드리지 않음 (새 업로드 이후에는 스크립트가 안전하게 no-op)
"""

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.common.database import async_session_factory
from src.config import settings
from src.pipeline.ingestion_models import IngestionJob, IngestionStatus
from src.pipeline.ingestion_repository import IngestionJobRepository
from src.qdrant_client import get_client


def aggregate_qdrant_volumes() -> dict[str, dict]:
    """Qdrant 전체 포인트를 scroll 하여 volume별 메타 집계.

    Returns:
        {volume: {count, source, title}}
    """
    client = get_client()
    offset = None
    volumes: dict[str, dict] = {}

    while True:
        points, next_offset = client.scroll(
            collection_name=settings.collection_name,
            limit=1000,
            offset=offset,
            with_payload=["volume", "source", "title"],
        )
        if not points:
            break
        for p in points:
            payload = p.payload or {}
            vol = payload.get("volume")
            if not vol:
                continue
            entry = volumes.setdefault(vol, {"count": 0, "source": "", "title": ""})
            entry["count"] += 1
            # 첫 non-empty source/title 유지
            if not entry["source"]:
                src = payload.get("source")
                if isinstance(src, list) and src:
                    entry["source"] = src[0]
                elif isinstance(src, str) and src:
                    entry["source"] = src
            if not entry["title"]:
                t = payload.get("title")
                if t:
                    entry["title"] = t
        if next_offset is None:
            break
        offset = next_offset

    return volumes


async def backfill(volumes: dict[str, dict], dry_run: bool) -> tuple[int, int]:
    """ingestion_jobs 테이블에 누락된 volume만 COMPLETED 상태로 insert.

    기존 row는 보존 (새 업로드가 있을 수 있으므로).

    Returns:
        (inserted_count, skipped_count)
    """
    inserted = 0
    skipped = 0
    now = datetime.utcnow()

    async with async_session_factory() as session:
        repo = IngestionJobRepository(session)

        for volume_key, info in sorted(volumes.items()):
            existing = await repo.get_by_volume_key(volume_key)
            if existing is not None:
                skipped += 1
                continue

            if dry_run:
                print(f"  [DRY] insert: {volume_key} → {info['count']}청크")
                inserted += 1
                continue

            job = IngestionJob(
                volume_key=volume_key,
                # 원본 파일명 소실 — volume을 그대로 사용 (UI 표시용)
                filename=volume_key,
                source=info["source"],
                total_chunks=info["count"],
                processed_chunks=info["count"],
                status=IngestionStatus.COMPLETED,
                created_at=now,
                updated_at=now,
                completed_at=now,
            )
            session.add(job)
            inserted += 1

        if not dry_run:
            await session.commit()

    return inserted, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Qdrant → ingestion_jobs 백필")
    parser.add_argument("--dry-run", action="store_true",
                        help="실제 insert 없이 미리보기만")
    args = parser.parse_args()

    print(f"🔍 Qdrant 집계 시작 (collection={settings.collection_name})")
    volumes = aggregate_qdrant_volumes()
    total_points = sum(v["count"] for v in volumes.values())
    print(f"   → {len(volumes)}개 volume, 총 {total_points:,}개 청크 발견\n")

    if not volumes:
        print("Qdrant에 포인트가 없습니다. 종료.")
        return

    print(f"📦 ingestion_jobs 백필 {'(DRY-RUN)' if args.dry_run else ''}")
    inserted, skipped = asyncio.run(backfill(volumes, args.dry_run))

    print(f"\n✅ 완료: {inserted}개 insert, {skipped}개 skip (기존 row 보존)")
    if args.dry_run:
        print("   --dry-run 모드. 실제 반영하려면 플래그 없이 다시 실행하세요.")


if __name__ == "__main__":
    main()
