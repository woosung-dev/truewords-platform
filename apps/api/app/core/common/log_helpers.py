"""로그 PII 누출 차단 helper.

audit 2차 S-5 (2026-05-15, codex meta β P1 신규 finding): 기존 검색/재작성 모듈이
사용자 원문 질문을 `logger.info` 와 `logger.warning` 의 `%r` / `%s` 로 그대로 stdout
출력 → Cloud Logging 에 PII (종교적/상담성 민감 질문 포함) 가 그대로 보존. fix 는
원문 query 를 `sha256:<12hex>/len=<N>` fingerprint 로 대체. 디버깅 추적은 request_id
+ DB session_messages 로 가능.
"""

from __future__ import annotations

import hashlib


def query_fingerprint(query: str) -> str:
    """User query → 추적용 hash + 길이 fingerprint.

    원문 log 누출 차단. 운영 logs 검색 시 동일 query 의 재발 빈도 추적은 hash 충돌
    가능성이 낮은 sha256 의 12-hex prefix 로 충분. 길이 정보는 abnormal-length query
    (예: prompt injection 시도) 운영 분석에 유용.

    Returns:
        "sha256:<12hex>/len=<N>" 형식. 빈 query 는 "sha256:<12hex>/len=0".
    """
    h = hashlib.sha256(query.encode("utf-8")).hexdigest()[:12]
    return f"sha256:{h}/len={len(query)}"
