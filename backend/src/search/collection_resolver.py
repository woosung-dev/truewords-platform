"""CollectionResolver — 챗봇 검색이 사용할 Qdrant 컬렉션 결정.

Phase 2.4 (v5 Recursive 88권 운영 채택) 이후 봇별 메인 컬렉션 토글은
폐기됐다. 모든 챗봇은 settings.collection_name 단일 컬렉션을 공유한다.
이 모듈은 호출부 통일 + 향후 봇별 분기 부활 시 진입점 역할을 위해 남겨둔다.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.config import settings


@dataclass(frozen=True)
class ResolvedCollections:
    main: str
    cache: str


def resolve_collections() -> ResolvedCollections:
    return ResolvedCollections(
        main=settings.collection_name,
        cache=settings.cache_collection_name,
    )
