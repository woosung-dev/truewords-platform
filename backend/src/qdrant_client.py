"""[DEPRECATED] Qdrant 클라이언트 호환 shim.

audit P0-7 (2026-05-15): 기존 파일 + 패키지 동명 공존을 해소했다. 모든 실제
구현은 `src.qdrant.factory` / `src.qdrant.startup` / `src.qdrant.raw_client` 에
있다. 본 모듈은:

- backend/scripts (마이그레이션·스키마) 가 사용해 온 `from src.qdrant_client
  import ...` 호환 유지
- tests 의 `patch("src.qdrant_client.get_async_client")` 등 mock target 호환

신규 코드는 `from src.qdrant import ...` 를 사용한다. 호출처 전수 이관이 끝나면
본 shim 도 제거 예정.
"""

from src.qdrant.factory import (
    create_collection,
    create_payload_indexes,
    get_async_client,
    get_client,
    get_raw_client,
)
from src.qdrant.startup import ensure_main_collection

__all__ = [
    "create_collection",
    "create_payload_indexes",
    "ensure_main_collection",
    "get_async_client",
    "get_client",
    "get_raw_client",
]
