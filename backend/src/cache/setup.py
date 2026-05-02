"""Semantic Cache 컬렉션 초기화 (idempotent).

raw httpx (HTTP/1.1) 로 Qdrant REST API 직접 호출. qdrant-client SDK 의 HTTP/2
경로가 Cloudflare Tunnel + Cloud Run 환경에서 cold instance hang 하는 문제를
회피한다. (PR #78 진단으로 raw HTTP/1.1 정상 동작 검증 완료)

상세: docs/dev-log/46-qdrant-cache-cold-start-debug.md
"""

import logging

import httpx

from src.config import settings

logger = logging.getLogger(__name__)

# qdrant-client 와 무관한 별도 클라이언트. HTTP/1.1 강제, 연결 cold start 흡수용 timeout.
_HTTP_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


def _api_key() -> str:
    return settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else ""


def _headers() -> dict[str, str]:
    return {"api-key": _api_key(), "Content-Type": "application/json"}


# 캐시 invalidation 메타데이터 — service.py 의 check_cache 와 동기화 필요.
_PAYLOAD_INDEXES: list[tuple[str, str]] = [
    ("chatbot_id", "keyword"),
    ("created_at", "float"),
    ("corpus_updated_at", "float"),  # ingestion 갱신 시 stale 처리용
    ("embedding_model", "keyword"),  # 모델 변경 시 자동 무효화
]


async def ensure_cache_collection() -> None:
    """캐시 컬렉션이 없으면 생성. 이미 있으면 누락된 payload index 만 보강.

    invalidation 메타데이터(corpus_updated_at, embedding_model) 를 신규 도입한 이후
    기존 컬렉션도 인덱스가 누락되어 있으므로 idempotent 하게 추가한다.
    Qdrant 는 동일 인덱스 재생성 시도를 흡수해주지만, 명시적으로 이미 있는 필드는
    skip 한다.
    """
    base = settings.qdrant_url.rstrip("/")
    name = settings.cache_collection_name

    async with httpx.AsyncClient(http2=False, timeout=_HTTP_TIMEOUT) as client:
        # 1) 컬렉션 존재 확인
        resp = await client.get(f"{base}/collections", headers=_headers())
        resp.raise_for_status()
        existing = {c["name"] for c in resp.json().get("result", {}).get("collections", [])}
        created_now = name not in existing

        if created_now:
            # 2-a) 컬렉션 생성 (dense 1536 cosine)
            create_body = {
                "vectors": {"dense": {"size": 1536, "distance": "Cosine"}},
            }
            resp = await client.put(
                f"{base}/collections/{name}", headers=_headers(), json=create_body
            )
            resp.raise_for_status()
            logger.info("ensure_cache_collection: '%s' 컬렉션 생성됨", name)
            existing_indexes: set[str] = set()
        else:
            # 2-b) 기존 컬렉션 — payload schema 조회해서 누락 인덱스 식별
            resp = await client.get(
                f"{base}/collections/{name}", headers=_headers()
            )
            resp.raise_for_status()
            schema = resp.json().get("result", {}).get("payload_schema", {}) or {}
            existing_indexes = set(schema.keys())

        # 3) payload index — 누락된 것만 추가 (idempotent)
        added: list[str] = []
        for field, field_schema in _PAYLOAD_INDEXES:
            if field in existing_indexes:
                continue
            resp = await client.put(
                f"{base}/collections/{name}/index",
                headers=_headers(),
                json={"field_name": field, "field_schema": field_schema},
            )
            resp.raise_for_status()
            added.append(field)

        if created_now:
            logger.info(
                "ensure_cache_collection: '%s' payload index %d종 생성됨",
                name,
                len(_PAYLOAD_INDEXES),
            )
        elif added:
            logger.info(
                "ensure_cache_collection: '%s' 누락 인덱스 보강: %s", name, added
            )
        else:
            logger.debug("ensure_cache_collection: '%s' 모든 인덱스 존재 → skip", name)
