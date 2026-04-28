"""Qdrant 컬렉션 간 vector + payload 복사 (filter exclude 지원).

옵션 F PoC 용도: malssum_poc (615권) → malssum_chunking_poc_* 3개 컬렉션
                평화경 1권은 PoC 청킹으로 별도 적재됐으므로, 나머지 614권은
                기존 임베딩 그대로 복사 (재임베딩 비용 절감).

사용 예:
    PYTHONPATH=. uv run python scripts/copy_qdrant_vectors.py \\
        --src malssum_poc --dst malssum_chunking_poc_token1024 \\
        --exclude-volume "평화경"
"""
from __future__ import annotations

import argparse
import time

from qdrant_client.models import (
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
)

from src.qdrant_client import get_client


def copy_with_filter(
    client,
    src: str,
    dst: str,
    exclude_volume: str,
    batch_size: int = 256,
) -> int:
    """src → dst 복사 (volume != exclude_volume 인 청크만). 재임베딩 없음."""
    flt = Filter(
        must_not=[
            FieldCondition(key="volume", match=MatchValue(value=exclude_volume)),
        ],
    )
    offset = None
    total = 0
    while True:
        points, offset = client.scroll(
            collection_name=src,
            scroll_filter=flt,
            limit=batch_size,
            with_vectors=True,
            with_payload=True,
            offset=offset,
        )
        if not points:
            break
        upserts = [
            PointStruct(id=p.id, vector=p.vector, payload=p.payload)
            for p in points
        ]
        client.upsert(collection_name=dst, points=upserts, wait=False)
        total += len(upserts)
        if total % 5000 < batch_size:
            print(f"  copied {total} ...")
        if offset is None:
            break
    return total


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", default="malssum_poc")
    parser.add_argument("--dst", required=True)
    parser.add_argument("--exclude-volume", required=True)
    parser.add_argument("--batch-size", type=int, default=256)
    args = parser.parse_args()

    client = get_client()
    print(f"copying {args.src} → {args.dst} (excluding volume='{args.exclude_volume}')")
    t0 = time.time()
    total = copy_with_filter(
        client, args.src, args.dst, args.exclude_volume, batch_size=args.batch_size,
    )
    print(f"done: {total} points in {time.time()-t0:.1f}s")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
