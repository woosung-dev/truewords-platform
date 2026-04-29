from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    SparseVectorParams,
    SparseIndexParams,
    PayloadSchemaType,
)
from src.config import settings
from src.qdrant import RawQdrantClient

# 비동기 클라이언트 (API 요청 처리용)
_async_client: AsyncQdrantClient | None = None
_raw_client: RawQdrantClient | None = None

# Cloudflare Tunnel·셀프 호스팅 VM 환경에서 cold start 시 첫 호출이
# qdrant-client 기본 timeout(5초)을 초과하는 사례가 관찰되어 60초로 명시.
# (참고: docs/dev-log/45-qdrant-self-hosting.md)
# SDK 자체가 HTTP/2 hang 하므로 chat 핫패스 (search) 는 get_raw_client() 사용.
_QDRANT_TIMEOUT = 60


def get_async_client() -> AsyncQdrantClient:
    """비동기 qdrant-client SDK 싱글턴 (admin/pipeline 용, search 핫패스 X).

    Cloudflare Tunnel + Cloud Run 환경에서 SDK HTTP/2 경로가 hang 하므로
    chat 핫패스에서는 ``get_raw_client()`` 를 사용한다. (PR #78 진단)
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

    SDK 의 HTTP/2 hang 을 회피한다. (docs/dev-log/47 참조)
    chat 핫패스 (search) 는 반드시 이쪽을 사용해야 한다.
    """
    global _raw_client
    if _raw_client is None:
        _raw_client = RawQdrantClient()
    return _raw_client


# 동기 클라이언트 (데이터 적재 스크립트용 — pipeline/)
def get_client() -> QdrantClient:
    api_key = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None
    return QdrantClient(url=settings.qdrant_url, api_key=api_key, timeout=_QDRANT_TIMEOUT)


def create_collection(client: QdrantClient, collection_name: str) -> None:
    client.create_collection(
        collection_name=collection_name,
        vectors_config={
            "dense": VectorParams(size=1536, distance=Distance.COSINE)
        },
        sparse_vectors_config={
            "sparse": SparseVectorParams(
                index=SparseIndexParams(on_disk=False)
            )
        },
    )


def create_payload_indexes(client: QdrantClient, collection_name: str) -> None:
    """검색 필터링 성능을 위한 payload index 생성."""
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
