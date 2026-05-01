"""Qdrant raw HTTP/1.1 클라이언트 모듈.

qdrant-client SDK 의 HTTP/2 경로가 Cloudflare Tunnel + Cloud Run 환경에서
60초 ConnectTimeout 으로 hang 하는 문제를 회피하기 위해 raw httpx 로 직접
Qdrant REST API 를 호출한다. (PR #78 진단, PR #83 cache 적용 검증 완료)

상세: docs/dev-log/47-qdrant-sdk-http2-permanent-fix.md
"""

from src.qdrant.raw_client import FacetHit, QdrantPoint, RawQdrantClient

__all__ = ["RawQdrantClient", "QdrantPoint", "FacetHit"]
