from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    SparseVectorParams,
    SparseIndexParams,
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
