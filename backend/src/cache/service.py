"""Semantic Cache 서비스. Qdrant 컬렉션 기반 유사 질문 캐시.

raw httpx (HTTP/1.1) 로 Qdrant REST API 직접 호출. qdrant-client SDK 의 HTTP/2
경로가 Cloudflare Tunnel + Cloud Run 환경에서 일관 hang 하는 문제를 회피.
(PR #78 진단으로 HTTP/1.1 정상 동작 검증)

상세: docs/dev-log/46-qdrant-cache-cold-start-debug.md

Invalidation 메타데이터 (R-cache-hardening, 2026-05-02):
  - chatbot_id          : 챗봇별 캐시 격리
  - created_at          : TTL 기반 freshness 필터
  - corpus_updated_at   : ingestion 갱신 시 자동 stale 처리 (Qdrant filter)
  - embedding_model     : 임베딩 모델 변경 시 자동 무효화 (Qdrant filter)

corpus_updated_at 은 `IngestionJob.completed_at` 의 max 값. 호출자(ChatService)
가 인자로 전달한다 — Cache 도메인이 ingestion 도메인 DB 에 직접 접근하지 않도록.
"""

import logging
import time
import uuid

import httpx

from src.cache.schemas import CacheHit
from src.common.gemini import MODEL_EMBEDDING
from src.config import settings

logger = logging.getLogger(__name__)

# raw httpx — HTTP/1.1 강제, cold start 흡수용 timeout
_HTTP_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class SemanticCacheService:
    """Qdrant 기반 Semantic Cache (raw httpx 호출).

    - 유사도 >= threshold 이면 캐시 히트
    - TTL 기반 오래된 캐시 자동 필터링
    - chatbot_id 별 캐시 격리
    - corpus 갱신 시 stale 처리
    - embedding 모델 변경 시 자동 무효화
    """

    def __init__(self) -> None:
        self.collection = settings.cache_collection_name
        self.threshold = settings.cache_threshold
        self.ttl_seconds = settings.cache_ttl_days * 86400
        # 임베딩 모델이 바뀌면 vector 가 호환되지 않으므로 cache 전체 무효화 필요.
        # payload 에 모델명을 적어두고 filter 로 mismatch 시 자동 miss 처리.
        self.embedding_model = MODEL_EMBEDDING
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
        corpus_updated_at: float | None = None,
        collection_name: str | None = None,
    ) -> CacheHit | None:
        """캐시 히트 검사. 유사도 >= threshold 이면 CacheHit 반환.

        Args:
            query_embedding: 사용자 질문 dense 임베딩
            chatbot_id:      챗봇별 캐시 격리 (None=공용)
            corpus_updated_at: 현재 corpus 의 max(IngestionJob.completed_at) Unix ts.
                               cache 의 값이 이보다 작으면 stale → Qdrant filter 가
                               자동 miss 처리. None 이면 corpus 검증 생략.
            collection_name: 측정/실험용 별도 컬렉션 override (기본=settings)
        """
        now = time.time()
        ttl_cutoff = now - self.ttl_seconds
        coll = collection_name or self.collection

        # Qdrant filter — mismatch 는 모두 cache miss 로 자동 처리됨.
        must: list[dict] = [
            {"key": "created_at", "range": {"gte": ttl_cutoff}},
            {"key": "embedding_model", "match": {"value": self.embedding_model}},
        ]
        if chatbot_id:
            must.append({"key": "chatbot_id", "match": {"value": chatbot_id}})
        if corpus_updated_at is not None:
            # cache 가 corpus 갱신 후에 만들어진 것이어야 valid.
            must.append(
                {"key": "corpus_updated_at", "range": {"gte": corpus_updated_at}}
            )

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
                logger.warning(
                    "semantic_cache.check error",
                    extra={
                        "event": "cache_error",
                        "chatbot_id": chatbot_id,
                        "error": repr(e),
                    },
                )
                return None

        points = resp.json().get("result", {}).get("points", [])
        if not points:
            # miss 사유는 (TTL/corpus/embedding/threshold/유사도) 모두 Qdrant filter
            # 한 번의 query 로 통합 처리되므로 구분 비용이 크다. 단일 'cache_miss' 로
            # 카운팅하고, 운영 hit-rate 는 hit/(hit+miss) 로 산출.
            logger.info(
                "semantic_cache.miss",
                extra={
                    "event": "cache_miss",
                    "chatbot_id": chatbot_id,
                    "corpus_updated_at": corpus_updated_at,
                    "embedding_model": self.embedding_model,
                    "threshold": self.threshold,
                },
            )
            return None

        p = points[0]
        payload = p.get("payload") or {}
        logger.info(
            "semantic_cache.hit",
            extra={
                "event": "cache_hit",
                "chatbot_id": chatbot_id,
                "score": p["score"],
                "threshold": self.threshold,
                "cache_age_seconds": now - float(payload.get("created_at", now)),
            },
        )
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
        corpus_updated_at: float | None = None,
        collection_name: str | None = None,
    ) -> None:
        """파이프라인 완료 후 캐시 저장.

        corpus_updated_at 은 IngestionJob.completed_at 의 현재 max 값. None 이면
        0.0 으로 저장되어 추후 corpus 갱신 시 자동으로 stale 처리됨.
        """
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
                "corpus_updated_at": float(corpus_updated_at or 0.0),
                "embedding_model": self.embedding_model,
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
                logger.info(
                    "semantic_cache.store",
                    extra={
                        "event": "cache_store",
                        "chatbot_id": chatbot_id,
                        "corpus_updated_at": corpus_updated_at,
                        "embedding_model": self.embedding_model,
                    },
                )
            except Exception as e:
                # store 실패는 RAG 응답엔 영향 없음
                logger.warning(
                    "semantic_cache.store_error",
                    extra={
                        "event": "cache_store_error",
                        "chatbot_id": chatbot_id,
                        "error": repr(e),
                    },
                )
