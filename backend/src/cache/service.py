"""Semantic Cache 서비스. Qdrant 컬렉션 기반 유사 질문 캐시."""

import time
import uuid

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Filter,
    FieldCondition,
    MatchValue,
    Range,
    PointStruct,
)

from src.cache.schemas import CacheHit
from src.config import settings


class SemanticCacheService:
    """Qdrant 기반 Semantic Cache.

    유사도 >= threshold 이면 캐시 히트.
    TTL 기반으로 오래된 캐시 자동 필터링.
    chatbot_id 별 캐시 격리.
    """

    def __init__(self, client: AsyncQdrantClient) -> None:
        self.client = client
        self.collection = settings.cache_collection_name
        self.threshold = settings.cache_threshold
        self.ttl_seconds = settings.cache_ttl_days * 86400

    async def check_cache(
        self,
        query_embedding: list[float],
        chatbot_id: str | None = None,
    ) -> CacheHit | None:
        """캐시 히트 검사. 유사도 >= threshold 이면 CacheHit 반환."""
        now = time.time()
        ttl_cutoff = now - self.ttl_seconds

        # 필터: TTL + chatbot_id (옵션)
        must_conditions = [
            FieldCondition(key="created_at", range=Range(gte=ttl_cutoff)),
        ]
        if chatbot_id:
            must_conditions.append(
                FieldCondition(key="chatbot_id", match=MatchValue(value=chatbot_id))
            )

        hits = await self.client.query_points(
            collection_name=self.collection,
            query=query_embedding,
            using="dense",
            query_filter=Filter(must=must_conditions),
            score_threshold=self.threshold,
            limit=1,
        )

        if not hits.points:
            return None

        point = hits.points[0]
        return CacheHit(
            question=point.payload["question"],
            answer=point.payload["answer"],
            sources=point.payload.get("sources", []),
            score=point.score,
            created_at=point.payload["created_at"],
        )

    async def store_cache(
        self,
        query: str,
        query_embedding: list[float],
        answer: str,
        sources: list[dict],
        chatbot_id: str | None = None,
    ) -> None:
        """파이프라인 완료 후 캐시 저장."""
        point = PointStruct(
            id=str(uuid.uuid4()),
            vector={"dense": query_embedding},
            payload={
                "question": query,
                "answer": answer,
                "sources": sources,
                "chatbot_id": chatbot_id or "",
                "created_at": time.time(),
            },
        )
        await self.client.upsert(
            collection_name=self.collection,
            points=[point],
        )
