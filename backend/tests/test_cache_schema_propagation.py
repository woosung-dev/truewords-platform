"""audit 2차 P-7 (2026-05-15) — cache schema propagation guard test.

[[feedback_cache_schema_propagation]] 패턴 강화: ``chat/schemas.Source`` 응답
schema 에 신규 필드가 추가되면 ``PersistStage.execute`` 의 ``sources_for_cache``
dict 도 같이 업데이트되어야 cache hit 응답에서 같은 필드를 채울 수 있다. 누락
시 cache hit 응답은 신규 필드가 None/default 로 잘려 사용자가 다른 결과를 본다.

PR #71 의 P0-B chunk_id 누락 사례가 본 패턴의 시초 — 본 test 는 향후 동일
회귀 차단.

화이트리스트 (cache 의도적 미포함):
- ``display_name``: admin 인라인 편집 결과. cache hit 시 응답 단계에서 별도 매핑.
- ``cited_phrase``: deprecated (INLINE_CITATIONS 폐기). 옛 cache payload 호환만.
"""

from __future__ import annotations

import inspect

from src.chat.pipeline.stages import persist
from src.chat.schemas import Source

# cache 의도적 미포함 필드 — 추가 시 본 화이트리스트 갱신 필요 (audit trail).
CACHE_EXCLUDED_FIELDS: set[str] = {"display_name", "cited_phrase"}


def _source_field_names() -> set[str]:
    """Source schema 가 노출하는 모든 필드 이름."""
    return set(Source.model_fields.keys())


def _persist_cache_dict_keys() -> set[str]:
    """PersistStage.execute source 안의 sources_for_cache dict 리터럴 키 집합.

    실제 dict comprehension 의 키만 추출. 향후 실수로 dict 키를 빼면 본 test 가
    catch — schema 와 cache propagation drift 회귀 가드.
    """
    src = inspect.getsource(persist)
    # naive 추출: "sources_for_cache = [" 이후 첫 "{...}" 블록 안의 키 문자열
    marker = "sources_for_cache = ["
    start = src.find(marker)
    assert start >= 0, "sources_for_cache literal 위치 변경 — test 갱신 필요"
    # closing "}" 를 찾아 dict literal 추출
    brace_open = src.find("{", start)
    brace_close = src.find("}", brace_open)
    block = src[brace_open + 1 : brace_close]
    keys: set[str] = set()
    for line in block.splitlines():
        line = line.strip().rstrip(",")
        if not line or line.startswith("#"):
            continue
        # `"key": ...,` 또는 `"key": ...`
        if line.startswith('"') and ":" in line:
            key = line.split(":", 1)[0].strip().strip('"')
            keys.add(key)
    return keys


def test_source_schema_fields_propagated_to_cache_or_excluded() -> None:
    """Source schema 의 모든 필드 = cache dict 키 ∪ 화이트리스트.

    drift 시나리오:
    1. Source 에 신규 필드 추가 → cache dict 미반영 + 화이트리스트 미명시 → 실패.
       해결: cache dict 에 추가 또는 ``CACHE_EXCLUDED_FIELDS`` 등록 + 코멘트.
    """
    source_fields = _source_field_names()
    cache_keys = _persist_cache_dict_keys()
    propagated = source_fields - CACHE_EXCLUDED_FIELDS
    missing = propagated - cache_keys
    assert not missing, (
        f"cache schema propagation drift — Source 신규 필드 {missing} 가 "
        f"sources_for_cache dict 에 없음. PersistStage 갱신 또는 "
        f"CACHE_EXCLUDED_FIELDS 등록 필요. [[feedback_cache_schema_propagation]]"
    )


def test_cache_dict_does_not_include_excluded_fields() -> None:
    """의도적 제외 필드는 cache dict 에 들어가서도 안 된다 — 명시적 분리 의도 보존."""
    cache_keys = _persist_cache_dict_keys()
    accidental = cache_keys & CACHE_EXCLUDED_FIELDS
    assert not accidental, (
        f"cache dict 가 의도적 제외 필드 {accidental} 를 포함 — "
        f"화이트리스트 정합성 깨짐. CACHE_EXCLUDED_FIELDS 갱신 필요."
    )


def test_cache_dict_has_core_fields() -> None:
    """기본 5필드 (volume / text / score / source / chunk_id) 보장 — 회귀 잠금."""
    cache_keys = _persist_cache_dict_keys()
    for required in ("volume", "text", "score", "source", "chunk_id"):
        assert required in cache_keys, f"cache dict 핵심 필드 {required} 누락"
