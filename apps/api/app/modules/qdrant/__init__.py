"""Qdrant 모듈 통합 진입점.

audit P0-7 (2026-05-15): 기존 `src/qdrant_client.py` (파일) + `app/modules/qdrant/`
(패키지) 동명 공존을 해소. 팩토리는 `qdrant.factory`, startup helper 는
`qdrant.startup`, raw client + filters 는 `qdrant.raw_client` / `qdrant.filters`.
호출처는 `from app.modules.qdrant import ...` 로 일관.

`src/qdrant_client.py` 는 backward-compat shim 으로 잔존하지만 신규 코드는
본 패키지를 사용한다.

상세: docs/dev-log/47-qdrant-sdk-http2-permanent-fix.md
"""

from app.modules.qdrant.factory import (
    create_collection,
    create_payload_indexes,
    get_async_client,
    get_client,
    get_raw_client,
)
from app.modules.qdrant.raw_client import FacetHit, QdrantPoint, RawQdrantClient
from app.modules.qdrant.startup import ensure_main_collection

__all__ = [
    "FacetHit",
    "QdrantPoint",
    "RawQdrantClient",
    "create_collection",
    "create_payload_indexes",
    "ensure_main_collection",
    "get_async_client",
    "get_client",
    "get_raw_client",
]
