"""CollectionResolver — 챗봇 검색이 사용할 Qdrant 컬렉션 결정.

Phase 2.4 (v5 Recursive 88권 운영 채택) 이후 봇별 메인 컬렉션 토글은
폐기됐다. 모든 챗봇은 settings.collection_name 단일 컬렉션을 공유한다.
시그니처는 호출부 호환을 위해 ChatbotRuntimeConfig 를 받지만 현재는
내용을 참조하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.chatbot.runtime_config import ChatbotRuntimeConfig
from src.config import settings


@dataclass(frozen=True)
class ResolvedCollections:
    main: str
    cache: str


def resolve_collections(runtime_config: ChatbotRuntimeConfig) -> ResolvedCollections:
    del runtime_config  # 현재 미사용 — Phase 2.4 이후 단일 컬렉션 운영
    return ResolvedCollections(
        main=settings.collection_name,
        cache=settings.cache_collection_name,
    )
