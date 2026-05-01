"""Semantic Cache 서비스. Qdrant 컬렉션 기반 유사 질문 캐시.

raw httpx (HTTP/1.1) 로 Qdrant REST API 직접 호출. qdrant-client SDK 의 HTTP/2
경로가 Cloudflare Tunnel + Cloud Run 환경에서 일관 hang 하는 문제를 회피.
(PR #78 진단으로 HTTP/1.1 정상 동작 검증)

상세: docs/dev-log/46-qdrant-cache-cold-start-debug.md
"""

import logging
import time
import uuid

import httpx

from src.cache.schemas import CacheHit
from src.config import settings

logger = logging.getLogger(__name__)

# raw httpx — HTTP/1.1 강제, cold start 흡수용 timeout
_HTTP_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class SemanticCacheService:
    """Qdrant 기반 Semantic Cache (raw httpx 호출).

    - 유사도 >= threshold 이면 캐시 히트
    - TTL 기반 오래된 캐시 자동 필터링
    - chatbot_id 별 캐시 격리
    """

    def __init__(self) -> None:
        # raw httpx 로 직접 호출 — qdrant-client 인자 불필요.
        self.collection = settings.cache_collection_name
        self.threshold = settings.cache_threshold
        self.ttl_seconds = settings.cache_ttl_days * 86400
        self._base = settings.qdrant_url.rstrip("/")
        self._api_key = (
            settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else ""
        )

    @property
    def _headers(self) -> dict[str, str]:
        return {"api-key": self._api_key, "Content-Type": "application/json"}

    async def check_cache(
        self,
        query_embedding: list[float],
        chatbot_id: str | None = None,
        collection_name: str | None = None,
    ) -> CacheHit | None:
        """캐시 히트 검사. 유사도 >= threshold 이면 CacheHit 반환."""
        now = time.time()
        ttl_cutoff = now - self.ttl_seconds
        coll = collection_name or self.collection

        # Qdrant REST API: POST /collections/{name}/points/query
        must: list[dict] = [
            {"key": "created_at", "range": {"gte": ttl_cutoff}},
        ]
        if chatbot_id:
            must.append({"key": "chatbot_id", "match": {"value": chatbot_id}})

        body = {
            "query": query_embedding,
            "using": "dense",
            "filter": {"must": must},
            "score_threshold": self.threshold,
            "limit": 1,
            "with_payload": True,
            "with_vector": False,
        }

        async with httpx.AsyncClient(http2=False, timeout=_HTTP_TIMEOUT) as client:
            try:
                resp = await client.post(
                    f"{self._base}/collections/{coll}/points/query",
                    headers=self._headers,
                    json=body,
                )
                resp.raise_for_status()
            except Exception as e:
                logger.warning("check_cache 실패 (graceful miss 처리): %r", e)
                return None

        points = resp.json().get("result", {}).get("points", [])
        if not points:
            return None

        p = points[0]
        payload = p.get("payload") or {}
        return CacheHit(
            question=payload["question"],
            answer=payload["answer"],
            sources=payload.get("sources", []),
            score=p["score"],
            created_at=payload["created_at"],
        )

    async def store_cache(
        self,
        query: str,
        query_embedding: list[float],
        answer: str,
        sources: list[dict],
        chatbot_id: str | None = None,
        collection_name: str | None = None,
    ) -> None:
        """파이프라인 완료 후 캐시 저장."""
        coll = collection_name or self.collection
        point = {
            "id": str(uuid.uuid4()),
            "vector": {"dense": query_embedding},
            "payload": {
                "question": query,
                "answer": answer,
                "sources": sources,
                "chatbot_id": chatbot_id or "",
                "created_at": time.time(),
            },
        }

        async with httpx.AsyncClient(http2=False, timeout=_HTTP_TIMEOUT) as client:
            try:
                resp = await client.put(
                    f"{self._base}/collections/{coll}/points",
                    headers=self._headers,
                    json={"points": [point]},
                )
                resp.raise_for_status()
            except Exception as e:
                # store 실패는 RAG 응답엔 영향 없음
                logger.warning("store_cache 실패 (RAG 응답엔 영향 없음): %r", e)
