"""Gemini 클라이언트 싱글턴 팩토리 (§13.1 S1).

3곳(common/gemini.py, pipeline/embedder.py, pipeline/batch_embedder.py) 에 분산된
`genai.Client(...)` 초기화를 한 팩토리로 일원화. retry 정책만 flag 로 분기.

retry 정책 선택:
- `retry_429=True` (기본): SDK 기본 재시도 정책. 429 포함 모든 retriable 에러 자동 재시도.
  common/gemini.py (chat 생성, 쿼리 임베딩) 및 batch_embedder.py (Batch API) 에서 사용.
- `retry_429=False`: 429 제외 + 5xx/408 만 3회 재시도. pipeline/embedder.py (대규모
  문서 임베딩 적재) 에서 사용 — ingestor.py 가 RPD/RPM 카운터로 429 를 직접 제어하므로
  SDK 의 이중 재시도를 막음.

실측(dev-log 25): google-genai 1.68 HttpRetryOptions 필드명은 `attempts`. Pydantic V2.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from google import genai
from google.genai import types

from src.config import settings


def _build_restricted_http_options() -> types.HttpOptions:
    """embedder.py 패턴: 429 제외 + 5xx/408 만 3회 재시도."""
    return types.HttpOptions(
        retry_options=types.HttpRetryOptions(
            attempts=3,
            initial_delay=1.0,
            max_delay=10.0,
            # 429 의도적 제외 — rate limit 은 ingestor.py 에서 제어
            http_status_codes=[408, 500, 502, 503, 504],
        )
    )


@lru_cache(maxsize=2)
def get_client(*, retry_429: bool = True) -> genai.Client:
    """Gemini 클라이언트 싱글턴 팩토리.

    per-process 캐시 (process-wide, stateless, thread-safe). retry_429 값별로 1 인스턴스씩.
    """
    http_options: Optional[types.HttpOptions]
    if retry_429:
        http_options = None
    else:
        http_options = _build_restricted_http_options()

    return genai.Client(
        api_key=settings.gemini_api_key.get_secret_value(),
        http_options=http_options,
    )


def clear_cache() -> None:
    """테스트/리로드 용. 일반 코드에서 호출 지양."""
    get_client.cache_clear()
