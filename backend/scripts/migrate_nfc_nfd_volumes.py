"""Qdrant 볼륨 페이로드를 NFC canonical로 통합하는 1회성 마이그레이션.

과거 ingest는 macOS NFD로, 최근 ingest는 NFC로 volume 페이로드를 저장.
이 둘이 Qdrant에 공존하면 `get_all_volumes` / `get_category_stats`에서
같은 문서가 두 엔트리로 보인다. (예: "말씀선집 002"가 미분류와 말씀선집
카테고리에 동시 표시)

## 동작

1. 전체 포인트 scroll → `(NFC(volume), chunk_index)` 키로 그룹핑
2. 각 그룹에서 volume 문자열 변이(NFC/NFD)가 1개면 스킵
3. 변이가 여러 개인 경우:
   - NFC variant가 있으면 그 포인트를 canonical로 유지
   - 없으면 NFD 중 하나를 골라 payload의 volume을 NFC로 rewrite
   - canonical의 source는 모든 변이의 source를 union
   - 나머지(중복) 포인트는 삭제

point_id는 NFD로 생성된 채로 둔다(재업로드 시 새 NFC point_id와 충돌하면
upsert로 자연스럽게 정리됨).

## 사용법

    cd backend
    uv run python -m scripts.migrate_nfc_nfd_volumes --dry-run  # 미리보기
    uv run python -m scripts.migrate_nfc_nfd_volumes            # 실행

"""

from __future__ import annotations

import argparse
import logging
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# 직접 실행(`python scripts/migrate_nfc_nfd_volumes.py`) 지원을 위해
# backend/ 루트를 sys.path에 추가. `python -m scripts.xxx` 호출 시는 불필요.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from qdrant_client import QdrantClient  # noqa: E402

from src.config import settings  # noqa: E402


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@dataclass
class PointRecord:
    point_id: Any
    volume_raw: str
    chunk_index: int | None
    sources: list[str] = field(default_factory=list)


def _coerce_sources(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw] if raw else []
    if isinstance(raw, list):
        return [s for s in raw if s]
    return []


def fetch_all_points(client: QdrantClient, collection: str) -> list[PointRecord]:
    """모든 포인트의 (point_id, volume, chunk_index, source) 수집."""
    records: list[PointRecord] = []
    offset = None
    scanned = 0
    while True:
        points, offset = client.scroll(
            collection_name=collection,
            with_payload=["volume", "chunk_index", "source"],
            with_vectors=False,
            limit=1000,
            offset=offset,
        )
        for p in points:
            payload = p.payload or {}
            volume = payload.get("volume", "")
            if not volume:
                continue
            chunk_index = payload.get("chunk_index")
            sources = _coerce_sources(payload.get("source"))
            records.append(
                PointRecord(
                    point_id=p.id,
                    volume_raw=volume,
                    chunk_index=chunk_index,
                    sources=sources,
                )
            )
        scanned += len(points)
        if scanned % 5000 == 0:
            logger.info("스캔 중... %d 포인트", scanned)
        if offset is None:
            break
    logger.info("스캔 완료: 총 %d 포인트", len(records))
    return records


def group_by_canonical(
    records: list[PointRecord],
) -> dict[tuple[str, int | None], list[PointRecord]]:
    """(NFC(volume), chunk_index) → 포인트 목록."""
    groups: dict[tuple[str, int | None], list[PointRecord]] = defaultdict(list)
    for rec in records:
        nfc = unicodedata.normalize("NFC", rec.volume_raw)
        groups[(nfc, rec.chunk_index)].append(rec)
    return groups


def pick_canonical(group: list[PointRecord], nfc_volume: str) -> PointRecord:
    """그룹에서 canonical 포인트 선택. NFC variant 우선, 없으면 첫 번째."""
    for rec in group:
        if rec.volume_raw == nfc_volume:
            return rec
    return group[0]


def summarize(groups: dict[tuple[str, int | None], list[PointRecord]]) -> dict:
    """통계 집계."""
    duplicate_groups = 0
    duplicate_points = 0
    volumes_with_variants: set[str] = set()
    nfd_canonical_rewrite = 0

    for (nfc, _chunk_index), members in groups.items():
        if len(members) <= 1:
            continue
        distinct_raws = {m.volume_raw for m in members}
        if len(distinct_raws) <= 1:
            continue
        duplicate_groups += 1
        duplicate_points += len(members) - 1
        volumes_with_variants.add(nfc)
        if nfc not in distinct_raws:
            nfd_canonical_rewrite += 1

    return {
        "duplicate_groups": duplicate_groups,
        "duplicate_points": duplicate_points,
        "affected_volumes": sorted(volumes_with_variants),
        "nfd_canonical_rewrite_groups": nfd_canonical_rewrite,
    }


def execute_migration(
    client: QdrantClient,
    collection: str,
    groups: dict[tuple[str, int | None], list[PointRecord]],
    dry_run: bool,
) -> dict:
    """실제 마이그레이션 수행."""
    stats = {
        "canonical_updated": 0,
        "points_deleted": 0,
        "source_union_changed": 0,
        "volume_rewritten_to_nfc": 0,
    }

    for (nfc, chunk_index), members in groups.items():
        if len(members) <= 1:
            continue
        distinct_raws = {m.volume_raw for m in members}
        if len(distinct_raws) <= 1:
            continue

        canonical = pick_canonical(members, nfc)
        non_canonical = [m for m in members if m.point_id != canonical.point_id]

        # source union
        merged_sources: set[str] = set()
        for m in members:
            merged_sources.update(m.sources)
        merged_sources_list = sorted(merged_sources)

        canonical_needs_volume_rewrite = canonical.volume_raw != nfc
        canonical_needs_source_update = sorted(canonical.sources) != merged_sources_list

        payload_update: dict[str, Any] = {}
        if canonical_needs_volume_rewrite:
            payload_update["volume"] = nfc
            stats["volume_rewritten_to_nfc"] += 1
        if canonical_needs_source_update:
            payload_update["source"] = merged_sources_list
            stats["source_union_changed"] += 1

        if payload_update:
            if not dry_run:
                client.set_payload(
                    collection_name=collection,
                    payload=payload_update,
                    points=[canonical.point_id],
                )
            stats["canonical_updated"] += 1
            logger.info(
                "[canonical] volume=%r chunk=%s id=%s update=%s",
                nfc,
                chunk_index,
                canonical.point_id,
                list(payload_update.keys()),
            )

        if non_canonical:
            delete_ids = [m.point_id for m in non_canonical]
            if not dry_run:
                client.delete(
                    collection_name=collection,
                    points_selector=delete_ids,
                )
            stats["points_deleted"] += len(delete_ids)
            logger.info(
                "[delete] volume=%r chunk=%s %d duplicates",
                nfc,
                chunk_index,
                len(delete_ids),
            )

    return stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="변경 없이 요약만 출력",
    )
    parser.add_argument(
        "--show-volumes",
        action="store_true",
        help="영향받는 volume 목록 전체 출력",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    api_key = (
        settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None
    )
    client = QdrantClient(url=settings.qdrant_url, api_key=api_key)
    collection = settings.collection_name

    logger.info("컬렉션: %s (dry_run=%s)", collection, args.dry_run)

    records = fetch_all_points(client, collection)
    groups = group_by_canonical(records)

    summary = summarize(groups)
    logger.info("─" * 50)
    logger.info("중복 그룹: %d", summary["duplicate_groups"])
    logger.info("중복 포인트 수(삭제 대상): %d", summary["duplicate_points"])
    logger.info("영향받는 volume 수: %d", len(summary["affected_volumes"]))
    logger.info(
        "NFC variant 없어 rewrite 필요한 그룹: %d",
        summary["nfd_canonical_rewrite_groups"],
    )
    if args.show_volumes and summary["affected_volumes"]:
        logger.info("영향 볼륨:")
        for vol in summary["affected_volumes"]:
            logger.info("  - %s", vol)
    logger.info("─" * 50)

    if summary["duplicate_groups"] == 0:
        logger.info("중복 없음. 마이그레이션 불필요.")
        return 0

    if args.dry_run:
        logger.info("dry-run 종료. 실제 적용하려면 --dry-run 없이 재실행.")
        return 0

    stats = execute_migration(client, collection, groups, dry_run=False)
    logger.info("─" * 50)
    logger.info("마이그레이션 완료")
    logger.info("  canonical payload 업데이트: %d", stats["canonical_updated"])
    logger.info("  volume → NFC rewrite: %d", stats["volume_rewritten_to_nfc"])
    logger.info("  source union 변경: %d", stats["source_union_changed"])
    logger.info("  중복 포인트 삭제: %d", stats["points_deleted"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
