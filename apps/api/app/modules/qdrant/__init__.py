"""Qdrant 모듈 통합 진입점.

팩토리는 `qdrant.factory`, raw client + filters 는 `qdrant.raw_client` /
`qdrant.filters`. 호출처는 `from app.modules.qdrant import ...` 로 일관.

상세: docs/adr/47-qdrant-sdk-http2-permanent-fix.md
"""

from app.modules.qdrant.factory import (
    get_client,
    get_raw_client,
)
from app.modules.qdrant.raw_client import FacetHit, QdrantPoint, RawQdrantClient

__all__ = [
    "FacetHit",
    "QdrantPoint",
    "RawQdrantClient",
    "get_client",
    "get_raw_client",
]
