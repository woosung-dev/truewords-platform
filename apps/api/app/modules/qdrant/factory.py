# Qdrant 클라이언트 팩토리 — SDK + raw httpx + startup helpers. P0-7 audit fix.
"""Qdrant 클라이언트 팩토리.

audit P0-7 (2026-05-15): 기존 `src/qdrant_client.py` (파일) + `app/modules/qdrant/`
(패키지) 동명 공존을 해소. 팩토리 + DEPRECATED 호환 헬퍼는 본 모듈 (`qdrant/
factory.py`), startup 헬퍼는 `qdrant/startup.py`. `qdrant/__init__.py` 가 모두
re-export 하므로 호출처는 `from app.modules.qdrant import ...` 로 일관.

`src/qdrant_client.py` 는 backward-compat shim 으로 잔존 (tests 의 patch target,
apps/api/scripts 호환). 신규 코드는 `app.modules.qdrant` 사용.

chat 핫패스 / admin / pipeline 모두 `get_raw_client()` (raw httpx, HTTP/1.1) 사용.
SDK `AsyncQdrantClient` / `QdrantClient` 는 apps/api/scripts 마이그레이션·스키마
작업 호환을 위해 잔존하지만 apps/api/src 내부에서는 사용하지 않는다.

상세: docs/dev-log/47-qdrant-sdk-http2-permanent-fix.md
"""

from __future__ import annotations

from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client.models import (
    Distance,
    PayloadSchemaType,
    SparseIndexParams,
    SparseVectorParams,
    VectorParams,
)

from app.core.config import settings
from app.modules.qdrant.raw_client import RawQdrantClient

# Cloudflare Tunnel·셀프 호스팅 VM 환경에서 cold start 시 첫 호출이
# qdrant-client 기본 timeout(5초)을 초과하는 사례가 관찰되어 60초로 명시.
_QDRANT_TIMEOUT = 60

# 비동기 SDK 클라이언트 (chat 핫패스 외 잔여 잠재 사용처).
_async_client: AsyncQdrantClient | None = None
_raw_client: RawQdrantClient | None = None


def get_async_client() -> AsyncQdrantClient:
    """비동기 qdrant-client SDK 싱글턴 (deprecated for chat path).

    SDK HTTP/2 경로가 Cloudflare Tunnel + Cloud Run 환경에서 hang 하므로
    chat 핫패스 / admin / pipeline 모두 ``get_raw_client()`` 를 사용한다.
    apps/api/src 사용처는 PR-E 이후 0건. 테스트 patch 호환을 위해 함수 자체는 유지.
    """
    global _async_client
    if _async_client is None:
        _api_key = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None
        _async_client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=_api_key,
            timeout=_QDRANT_TIMEOUT,
        )
    return _async_client


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


def create_collection(client: QdrantClient, collection_name: str) -> None:
    """[DEPRECATED for apps/api/src] apps/api/scripts 호환용. 신규 코드는 ``ensure_main_collection`` 사용."""
    client.create_collection(
        collection_name=collection_name,
        vectors_config={"dense": VectorParams(size=1536, distance=Distance.COSINE)},
        sparse_vectors_config={
            "sparse": SparseVectorParams(index=SparseIndexParams(on_disk=False))
        },
    )


def create_payload_indexes(client: QdrantClient, collection_name: str) -> None:
    """[DEPRECATED for apps/api/src] apps/api/scripts 호환용. 신규 코드는 ``ensure_main_collection`` 사용."""
    client.create_payload_index(
        collection_name=collection_name,
        field_name="source",
        field_schema=PayloadSchemaType.KEYWORD,
    )
    client.create_payload_index(
        collection_name=collection_name,
        field_name="volume",
        field_schema=PayloadSchemaType.KEYWORD,
    )
