from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    SparseVectorParams,
    SparseIndexParams,
    PayloadSchemaType,
)
from src.config import settings


def get_client() -> QdrantClient:
    return QdrantClient(url=settings.qdrant_url)


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
