from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    SparseVectorParams,
    SparseIndexParams,
    PayloadSchemaType,
)
from src.config import settings

# 비동기 클라이언트 (API 요청 처리용)
_async_client: AsyncQdrantClient | None = None


def get_async_client() -> AsyncQdrantClient:
    """비동기 Qdrant 클라이언트 싱글턴."""
    global _async_client
    if _async_client is None:
        _api_key = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None
        _async_client = AsyncQdrantClient(url=settings.qdrant_url, api_key=_api_key)
    return _async_client


# 동기 클라이언트 (데이터 적재 스크립트용 — pipeline/)
def get_client() -> QdrantClient:
    api_key = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None
    return QdrantClient(url=settings.qdrant_url, api_key=api_key)


def create_collection(client: QdrantClient, collection_name: str) -> None:
    client.create_collection(
        collection_name=collection_name,
        vectors_config={
            "dense": VectorParams(size=3072, distance=Distance.COSINE)
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
