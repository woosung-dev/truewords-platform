"""Qdrant 컬렉션 생성 (멱등) — malssum_poc과 동일 스키마.

Dense 1536 COSINE + sparse + payload indexes (source/volume).
원래 malssum_poc_v2 (옵션 B Anthropic Contextual Retrieval A/B) 전용이었으나,
옵션 F 청킹 PoC에서 재사용을 위해 --name 옵션으로 일반화.

사용 예:
    PYTHONPATH=. uv run python scripts/create_collection_v2.py
    PYTHONPATH=. uv run python scripts/create_collection_v2.py --name malssum_chunking_poc_token1024
"""
from __future__ import annotations

import argparse
import sys

from src.qdrant_client import (
    create_collection,
    create_payload_indexes,
    get_client,
)


DEFAULT_NAME = "malssum_poc_v2"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--name",
        default=DEFAULT_NAME,
        help=f"컬렉션 이름 (default: {DEFAULT_NAME})",
    )
    args = parser.parse_args()

    client = get_client()
    existing = {c.name for c in client.get_collections().collections}
    if args.name in existing:
        print(f"이미 존재 (멱등): {args.name}")
        return 0
    create_collection(client, args.name)
    create_payload_indexes(client, args.name)
    print(f"생성 완료: {args.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
