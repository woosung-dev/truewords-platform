"""v5 컬렉션 volume payload 일괄 정정 backfill.

문제: ``batch_service.py`` 가 ``meta["volume"]`` 무시하고 ``job.volume_key``
(filename) 를 payload.volume 으로 저장 → v5 컬렉션 모든 chunk 의 volume 이
file stem 형식 ("말씀선집 056권.pdf"). 결과: Phase 3 메타데이터 필터
(``MatchValue("056권")``) 가 0건 매칭, 사실상 no-op 으로 동작.

본 스크립트:
1. 전체 컬렉션 scroll → 각 chunk 의 현재 volume 값 확인
2. ``derive_volume()`` 으로 정정된 값 계산 (예: "말씀선집 056권.pdf" → "056")
3. 변경 필요 시 ``set_payload`` API 로 update (벡터 재계산 0건)

기본 dry-run, ``--apply`` 플래그로만 실제 변경.

사용:
    cd backend
    PYTHONPATH=. uv run python scripts/backfill_volume_payload.py \\
        [--collection malssum_poc_v5] [--apply] [--batch-size 100]

진단 로그:
    - 변경 대상 / 정상 / 매칭 실패 케이스 분류
    - dry-run: WOULD UPDATE n / SKIP m
    - apply: UPDATED n / SKIP m
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter, defaultdict

from src.config import settings
from src.pipeline.metadata import derive_volume
from src.qdrant_client import get_raw_client


async def backfill(
    collection_name: str,
    apply: bool,
    batch_size: int = 100,
    page_size: int = 1000,
) -> None:
    client = get_raw_client()

    next_offset = None
    total_seen = 0
    same_count = 0
    diff_count = 0
    fallback_filename_count = 0  # derive_volume 이 fallback (파일명 그대로) 케이스

    # 변경 batch — 같은 new_volume 끼리 모아 set_payload 1회로 처리 (효율 ↑)
    pending_updates: dict[str, list] = defaultdict(list)  # new_volume -> [point_ids]

    async def flush_pending() -> int:
        n = sum(len(ids) for ids in pending_updates.values())
        if not n:
            return 0
        if apply:
            for new_vol, point_ids in pending_updates.items():
                # batch 분할 — set_payload 가 너무 많은 ID 받으면 부담
                for i in range(0, len(point_ids), batch_size):
                    chunk_ids = point_ids[i : i + batch_size]
                    await client.set_payload(
                        collection_name,
                        payload={"volume": new_vol},
                        points=chunk_ids,
                        wait=True,
                    )
        pending_updates.clear()
        return n

    sample_changes: Counter[tuple[str, str]] = Counter()  # (old, new) 분포

    while True:
        points, next_offset = await client.scroll(
            collection_name,
            with_payload=["volume"],
            with_vectors=False,
            limit=page_size,
            offset=next_offset,
        )
        if not points:
            break

        for p in points:
            total_seen += 1
            old_vol = (p.payload or {}).get("volume", "")
            new_vol = derive_volume(old_vol)
            if new_vol == old_vol:
                same_count += 1
                continue
            diff_count += 1
            if new_vol == old_vol:
                # derive_volume fallback branch — 사실상 same
                pass
            if new_vol == old_vol or len(new_vol) > 30:
                # fallback (파일명 그대로) 또는 비정상
                fallback_filename_count += 1
            sample_changes[(old_vol[:50], new_vol[:50])] += 1
            pending_updates[new_vol].append(p.id)

        # 일정 분량 모이면 flush
        if sum(len(v) for v in pending_updates.values()) >= 5000:
            n = await flush_pending()
            mode = "UPDATED" if apply else "WOULD UPDATE"
            print(f"  [{total_seen}건 스캔] flush {mode} {n}건")

        if not next_offset:
            break

    # 마지막 flush
    n = await flush_pending()
    if n:
        mode = "UPDATED" if apply else "WOULD UPDATE"
        print(f"  [최종 flush] {mode} {n}건")

    print()
    print(f"=== 결과 ({collection_name}) ===")
    print(f"전체: {total_seen}")
    print(f"  유지 (변경 불필요): {same_count}")
    print(f"  변경 대상: {diff_count}")
    print(f"  → 그 중 fallback (파일명 그대로): {fallback_filename_count}")
    print(f"모드: {'APPLY (실제 변경)' if apply else 'DRY-RUN (변경 없음)'}")
    print()
    print("변경 분포 상위 10:")
    for (old, new), n in sample_changes.most_common(10):
        print(f"  {n:5d}  {old!r}  →  {new!r}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--collection", default=settings.collection_name,
                   help=f"대상 컬렉션 (기본: {settings.collection_name})")
    p.add_argument("--apply", action="store_true",
                   help="실제 변경 적용 (기본은 dry-run)")
    p.add_argument("--batch-size", type=int, default=100,
                   help="set_payload 1회 호출 당 point ID 수 (기본 100)")
    p.add_argument("--page-size", type=int, default=1000,
                   help="scroll 페이지 크기 (기본 1000)")
    args = p.parse_args()

    print(f"backfill_volume_payload — collection={args.collection!r}, apply={args.apply}")
    print()
    asyncio.run(backfill(
        collection_name=args.collection,
        apply=args.apply,
        batch_size=args.batch_size,
        page_size=args.page_size,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
