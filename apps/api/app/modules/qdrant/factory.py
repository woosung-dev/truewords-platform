# Qdrant 클라이언트 팩토리 — SDK + raw httpx.
"""Qdrant 클라이언트 팩토리.

`qdrant/__init__.py` 가 re-export 하므로 호출처는
`from app.modules.qdrant import ...` 로 일관.

chat 핫패스 / admin / pipeline 모두 `get_raw_client()` (raw httpx, HTTP/1.1) 사용.
동기 SDK `QdrantClient` (`get_client()`) 는 apps/api/scripts 마이그레이션·스키마
작업 호환용으로 잔존한다.

상세: docs/adr/47-qdrant-sdk-http2-permanent-fix.md
"""

from __future__ import annotations

from qdrant_client import QdrantClient

from app.core.config import settings
from app.modules.qdrant.raw_client import RawQdrantClient

# Cloudflare Tunnel·셀프 호스팅 VM 환경에서 cold start 시 첫 호출이
# qdrant-client 기본 timeout(5초)을 초과하는 사례가 관찰되어 60초로 명시.
_QDRANT_TIMEOUT = 60

_raw_client: RawQdrantClient | None = None


def get_raw_client() -> RawQdrantClient:
    """raw httpx (HTTP/1.1) 기반 Qdrant REST 클라이언트 싱글턴.

    SDK 의 HTTP/2 hang 을 회피한다. (docs/dev-log/47 참조) chat 핫패스 / admin /
    pipeline 모두 본 클라이언트를 사용해야 한다.
    """
    global _raw_client
    if _raw_client is None:
        _raw_client = RawQdrantClient()
    return _raw_client


# 동기 클라이언트 — apps/api/scripts (마이그레이션·스키마 작업) 호환용으로 잔존.
def get_client() -> QdrantClient:
    api_key = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None
    return QdrantClient(url=settings.qdrant_url, api_key=api_key, timeout=_QDRANT_TIMEOUT)
