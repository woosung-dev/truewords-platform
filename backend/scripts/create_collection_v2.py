"""malssum_poc_v2 컬렉션 생성 (옵션 B Anthropic Contextual Retrieval A/B용).

malssum_poc과 동일한 스키마: dense 1536 COSINE + sparse + payload indexes (source/volume).
이미 존재하면 no-op (멱등).

사용 예:
    PYTHONPATH=. uv run python scripts/create_collection_v2.py
"""
from __future__ import annotations

import sys

from src.qdrant_client import (
    create_collection,
    create_payload_indexes,
    get_client,
)


COLLECTION_V2 = "malssum_poc_v2"


def main() -> int:
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}
    if COLLECTION_V2 in existing:
        print(f"이미 존재 (멱등): {COLLECTION_V2}")
        return 0
    create_collection(client, COLLECTION_V2)
    create_payload_indexes(client, COLLECTION_V2)
    print(f"생성 완료: {COLLECTION_V2}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
