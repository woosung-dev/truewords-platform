"""CollectionResolver — ChatbotRuntimeConfig → Qdrant collection 결정.

runtime_config.search.collection_main / collection_cache 가 None 이면
settings 기본값 (collection_name / cache_collection_name) 으로 fallback.
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
    return ResolvedCollections(
        main=runtime_config.search.collection_main or settings.collection_name,
        cache=runtime_config.search.collection_cache or settings.cache_collection_name,
    )
