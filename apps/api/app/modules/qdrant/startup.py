# Qdrant 컬렉션 startup helper — raw httpx HTTP/1.1 idempotent ensure_main_collection. P0-7 audit fix.
"""Qdrant startup helper (raw httpx HTTP/1.1).

audit P0-7 (2026-05-15): 기존 `src/qdrant_client.py` 와 분리. SDK 의존성 없이
raw httpx 로 메인 컬렉션 생성. cache 의 `ensure_cache_collection` 과 동일 패턴.

상세: docs/dev-log/47-qdrant-sdk-http2-permanent-fix.md
"""

from __future__ import annotations

import httpx

from app.core.config import settings

_STARTUP_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


def _startup_headers() -> dict[str, str]:
    api_key = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else ""
    return {"api-key": api_key, "Content-Type": "application/json"}


def ensure_main_collection(collection_name: str) -> None:
    """메인 컬렉션이 없으면 생성 (idempotent, raw httpx HTTP/1.1).

    cache 의 ``ensure_cache_collection`` 과 동일 패턴. dense(1536, cosine) +
    sparse(on_disk=False) 조합 + payload index (source / volume).
    """
    base = settings.qdrant_url.rstrip("/")
    headers = _startup_headers()

    with httpx.Client(http2=False, timeout=_STARTUP_TIMEOUT) as client:
        # 1) 존재 확인
        resp = client.get(f"{base}/collections", headers=headers)
        resp.raise_for_status()
        existing = {c["name"] for c in resp.json().get("result", {}).get("collections", [])}
        if collection_name in existing:
            return

        # 2) 컬렉션 생성 (dense 1536 cosine + sparse)
        resp = client.put(
            f"{base}/collections/{collection_name}",
            headers=headers,
            json={
                "vectors": {"dense": {"size": 1536, "distance": "Cosine"}},
                "sparse_vectors": {"sparse": {"index": {"on_disk": False}}},
            },
        )
        resp.raise_for_status()

        # 3) payload index (source / volume)
        for field in ("source", "volume"):
            resp = client.put(
                f"{base}/collections/{collection_name}/index",
                headers=headers,
                json={"field_name": field, "field_schema": "keyword"},
            )
            resp.raise_for_status()
