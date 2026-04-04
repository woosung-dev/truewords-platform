"""Semantic Cache 컬렉션 초기화 (idempotent)."""

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PayloadSchemaType,
)

from src.config import settings
from src.qdrant_client import get_async_client


async def ensure_cache_collection() -> None:
    """캐시 컬렉션이 없으면 생성. 이미 있으면 무시."""
    client = get_async_client()
    collections = await client.get_collections()
    existing = [c.name for c in collections.collections]

    if settings.cache_collection_name in existing:
        return

    await client.create_collection(
        collection_name=settings.cache_collection_name,
        vectors_config={
            "dense": VectorParams(size=3072, distance=Distance.COSINE),
        },
    )

    # payload 인덱스 생성
    await client.create_payload_index(
        collection_name=settings.cache_collection_name,
        field_name="chatbot_id",
        field_schema=PayloadSchemaType.KEYWORD,
    )
    await client.create_payload_index(
        collection_name=settings.cache_collection_name,
        field_name="created_at",
        field_schema=PayloadSchemaType.FLOAT,
    )
