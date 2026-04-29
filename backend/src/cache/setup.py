"""Semantic Cache 컬렉션 초기화 (idempotent).

NOTE: 이 함수는 qdrant-client SDK 대신 **raw httpx (HTTP/1.1)** 로 Qdrant REST API
를 직접 호출한다. qdrant-client 는 httpx[http2] 의존이라 HTTP/2 강제 사용하는데,
Cloudflare Tunnel + Cloud Run cold instance 조합에서 lifespan/lazy init 시점에
HTTP/2 SETTINGS frame 교환이 일관 hang하는 문제가 관찰됨 (PR #78 진단).

raw HTTP/1.1 호출은 같은 환경에서 정상 동작 검증 완료 (309ms로 200 OK).
나머지 cache 사용 코드(SemanticCacheService 등)는 warm path 라 SDK 그대로 사용.

상세: docs/dev-log/46-qdrant-cache-cold-start-debug.md
"""

import logging

import httpx

from src.config import settings

logger = logging.getLogger(__name__)

# qdrant-client 와 무관한 별도 클라이언트. HTTP/1.1 강제, 30s 충분한 timeout.
_HTTP_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


def _api_key() -> str:
    return settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else ""


def _headers() -> dict[str, str]:
    return {"api-key": _api_key(), "Content-Type": "application/json"}


async def ensure_cache_collection() -> None:
    """캐시 컬렉션이 없으면 생성. 이미 있으면 무시.

    raw httpx HTTP/1.1로 Qdrant REST API 직접 호출 (qdrant-client SDK 우회).
    """
    base = settings.qdrant_url.rstrip("/")
    name = settings.cache_collection_name

    async with httpx.AsyncClient(http2=False, timeout=_HTTP_TIMEOUT) as client:
        # 1) 컬렉션 존재 여부 조회
        resp = await client.get(f"{base}/collections", headers=_headers())
        resp.raise_for_status()
        existing = {c["name"] for c in resp.json().get("result", {}).get("collections", [])}
        if name in existing:
            logger.debug("ensure_cache_collection: '%s' 이미 존재 → skip", name)
            return

        # 2) 컬렉션 생성 (dense 1536 cosine)
        create_body = {
            "vectors": {
                "dense": {"size": 1536, "distance": "Cosine"},
            },
        }
        resp = await client.put(
            f"{base}/collections/{name}", headers=_headers(), json=create_body
        )
        resp.raise_for_status()
        logger.info("ensure_cache_collection: '%s' 컬렉션 생성됨", name)

        # 3) payload index 생성 (chatbot_id keyword, created_at float)
        for field, schema in [("chatbot_id", "keyword"), ("created_at", "float")]:
            idx_body = {"field_name": field, "field_schema": schema}
            resp = await client.put(
                f"{base}/collections/{name}/index",
                headers=_headers(),
                json=idx_body,
            )
            resp.raise_for_status()
        logger.info("ensure_cache_collection: '%s' payload index 2종 생성됨", name)
