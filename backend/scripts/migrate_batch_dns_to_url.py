"""ADR-30 follow-up: legacy NAMESPACE_DNS Point ID → NAMESPACE_URL 마이그레이션.

배경
====
PR #66 이전, ``backend/src/pipeline/batch_service.py``는 batch 적재 Point ID를
``uuid.uuid5(uuid.NAMESPACE_DNS, f"{volume}:{i}")``로 생성했다. 같은 시기 즉시
모드(`pipeline/ingestor.py`)는 ``uuid.NAMESPACE_URL``을 썼다. 두 모드가 같은
파일을 처리해도 서로 다른 Point ID를 만들어 운영 컬렉션에 두 벌의 데이터가
공존할 수 있고, 검색 결과 중복 hit으로 이어진다.

PR #66은 batch 측을 NAMESPACE_URL로 정렬했다. 이후 운영 컬렉션에 남아있는
DNS-ID 점들을 안전하게 마이그레이션해야 한다.

실행 (반드시 ``backend`` cwd에서 ``-m`` 모듈 경로로 실행한다)
================================================
    # 1) dry-run — 영향 통계만 출력 (변경 없음)
    cd backend
    uv run python -m scripts.migrate_batch_dns_to_url --dry-run

    # 2) 실제 마이그레이션 (재할당 + 원본 삭제)
    uv run python -m scripts.migrate_batch_dns_to_url --execute

    # (옵션) 특정 volume만
    uv run python -m scripts.migrate_batch_dns_to_url --dry-run --volume "말씀선집_001.pdf"

알고리즘
========
1. Qdrant 컬렉션 전체를 scroll하면서 각 점의 (volume, chunk_index)로 NAMESPACE_DNS
   재계산 ID를 구한다.
2. ``str(point.id) == expected_dns_id`` 이면 legacy — URL-ID로 재할당 대상.
3. 같은 chunk_key의 NAMESPACE_URL 점이 이미 존재하는지 retrieve로 확인:
   - URL-ID 점이 이미 있다 → 충돌. 운영 데이터 무결성 점검 필요. WARN + skip.
   - URL-ID 점이 없다 → DNS-ID 점의 vector + payload를 그대로 URL-ID upsert.
4. URL-ID 적재 성공 후에만 DNS-ID 점 삭제.

주의
====
- 마이그레이션 실행 전 Qdrant snapshot 권장 (운영 백업).
- 즉시 모드(NAMESPACE_URL) 점은 항상 안전 — 본 스크립트에 영향 받지 않는다.
- batch 모드에서 적재된 점만 NAMESPACE_DNS를 사용했다.
"""

from __future__ import annotations

import argparse
import logging
import sys
import uuid
from collections import defaultdict
from dataclasses import dataclass

from qdrant_client.models import PointIdsList, PointStruct, SparseVector

from src.config import settings
from src.qdrant_client import get_client

logger = logging.getLogger("migrate_batch_dns_to_url")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


@dataclass
class LegacyPoint:
    """DNS-ID로 적재된 legacy 점의 마이그레이션 정보."""

    dns_id: str
    url_id: str
    volume: str
    chunk_index: int
    vector: dict
    payload: dict


def _scan_legacy_points(volume_filter: str | None) -> list[LegacyPoint]:
    """전체 컬렉션을 scroll하며 NAMESPACE_DNS로 추정되는 legacy 점들을 모은다."""
    client = get_client()
    legacy: list[LegacyPoint] = []
    skipped_no_meta = 0
    offset = None

    while True:
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        scroll_filter = None
        if volume_filter is not None:
            scroll_filter = Filter(
                must=[FieldCondition(key="volume", match=MatchValue(value=volume_filter))]
            )

        points, offset = client.scroll(
            collection_name=settings.collection_name,
            scroll_filter=scroll_filter,
            with_payload=True,
            with_vectors=True,
            limit=512,
            offset=offset,
        )
        for p in points:
            payload = p.payload or {}
            volume = payload.get("volume")
            chunk_index = payload.get("chunk_index")
            if volume is None or chunk_index is None:
                skipped_no_meta += 1
                continue
            chunk_key = f"{volume}:{chunk_index}"
            expected_dns = str(uuid.uuid5(uuid.NAMESPACE_DNS, chunk_key))
            expected_url = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_key))
            if str(p.id) == expected_dns:
                legacy.append(
                    LegacyPoint(
                        dns_id=expected_dns,
                        url_id=expected_url,
                        volume=str(volume),
                        chunk_index=int(chunk_index),
                        vector=p.vector if isinstance(p.vector, dict) else {"dense": p.vector},
                        payload=payload,
                    )
                )
        if offset is None:
            break

    if skipped_no_meta:
        logger.info("payload에 volume/chunk_index 없는 점 %d개 skip", skipped_no_meta)
    return legacy


def _check_url_id_collisions(legacy_points: list[LegacyPoint]) -> set[str]:
    """legacy 점의 URL-ID가 이미 컬렉션에 존재하는지 retrieve로 일괄 확인."""
    if not legacy_points:
        return set()
    client = get_client()
    url_ids = [lp.url_id for lp in legacy_points]
    # Qdrant retrieve는 id 리스트로 일괄 조회
    existing = client.retrieve(
        collection_name=settings.collection_name,
        ids=url_ids,
        with_payload=False,
        with_vectors=False,
    )
    return {str(p.id) for p in existing}


def _migrate(legacy_points: list[LegacyPoint], dry_run: bool) -> dict:
    """legacy 점들을 URL-ID로 재할당. dry_run=True면 통계만 반환."""
    stats = {
        "total_legacy": len(legacy_points),
        "would_migrate": 0,
        "would_skip_collision": 0,
        "migrated": 0,
        "skipped_collision": 0,
        "deleted_dns_ids": 0,
    }

    if not legacy_points:
        return stats

    existing_url_ids = _check_url_id_collisions(legacy_points)
    safe = [lp for lp in legacy_points if lp.url_id not in existing_url_ids]
    collisions = [lp for lp in legacy_points if lp.url_id in existing_url_ids]

    stats["would_migrate"] = len(safe)
    stats["would_skip_collision"] = len(collisions)

    if collisions:
        sample = collisions[:5]
        logger.warning(
            "%d개 chunk_key에서 URL-ID가 이미 컬렉션에 존재 — skip. 샘플: %s",
            len(collisions),
            [(lp.volume, lp.chunk_index) for lp in sample],
        )

    if dry_run:
        return stats

    client = get_client()

    # 1) URL-ID로 upsert (vector + payload 그대로 복사)
    upsert_points: list[PointStruct] = []
    for lp in safe:
        vector_dict = {}
        for key, val in lp.vector.items():
            if isinstance(val, dict) and "indices" in val:
                vector_dict[key] = SparseVector(
                    indices=val["indices"], values=val["values"]
                )
            else:
                vector_dict[key] = val
        upsert_points.append(
            PointStruct(id=lp.url_id, vector=vector_dict, payload=lp.payload)
        )

    BATCH = 64
    for i in range(0, len(upsert_points), BATCH):
        chunk = upsert_points[i : i + BATCH]
        client.upsert(collection_name=settings.collection_name, points=chunk)
        stats["migrated"] += len(chunk)
        logger.info(
            "URL-ID upsert %d/%d", stats["migrated"], len(safe),
        )

    # 2) DNS-ID 일괄 삭제 (URL-ID upsert 성공 후에만)
    dns_ids_to_delete = [lp.dns_id for lp in safe]
    for i in range(0, len(dns_ids_to_delete), BATCH):
        chunk = dns_ids_to_delete[i : i + BATCH]
        client.delete(
            collection_name=settings.collection_name,
            points_selector=PointIdsList(points=list(chunk)),
        )
        stats["deleted_dns_ids"] += len(chunk)

    stats["skipped_collision"] = len(collisions)
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true", help="변경 없이 영향만 출력")
    g.add_argument("--execute", action="store_true", help="실제 마이그레이션 수행")
    parser.add_argument("--volume", default=None, help="특정 volume만 처리")
    args = parser.parse_args()

    logger.info(
        "스캔 시작 — collection=%s, volume_filter=%s",
        settings.collection_name,
        args.volume,
    )

    legacy = _scan_legacy_points(args.volume)
    if not legacy:
        logger.info("legacy NAMESPACE_DNS 점 없음 — 마이그레이션 불필요")
        return 0

    by_volume: dict[str, int] = defaultdict(int)
    for lp in legacy:
        by_volume[lp.volume] += 1
    logger.info(
        "legacy 점 %d개 발견 (%d volume)",
        len(legacy),
        len(by_volume),
    )
    for vol, cnt in sorted(by_volume.items(), key=lambda kv: -kv[1])[:10]:
        logger.info("  - %s: %d청크", vol, cnt)

    stats = _migrate(legacy, dry_run=args.dry_run)
    if args.dry_run:
        logger.info(
            "[dry-run] 마이그레이션 가능: %d / 충돌 skip: %d (총 legacy %d)",
            stats["would_migrate"],
            stats["would_skip_collision"],
            stats["total_legacy"],
        )
    else:
        logger.info(
            "[execute] 완료 — URL-ID upsert: %d / DNS-ID 삭제: %d / skip: %d",
            stats["migrated"],
            stats["deleted_dns_ids"],
            stats["skipped_collision"],
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
