"""Reranker swappable 인터페이스.

등록 키: ``gemini-flash`` (default).
RetrievalConfig.reranker_model 의 Literal 키와 1:1 매핑.
"""
from __future__ import annotations

from typing import Protocol

from src.search.hybrid import SearchResult


class Reranker(Protocol):
    """Reranker 공통 인터페이스. 어댑터는 .name 속성과 async rerank() 노출."""

    name: str

    async def rerank(
        self,
        query: str,
        results: list[SearchResult],
        top_k: int = 10,
    ) -> list[SearchResult]: ...


# 싱글톤 캐싱: 동일 키로 재호출 시 같은 인스턴스 반환.
_INSTANCES: dict[str, Reranker] = {}


def get_reranker(name: str) -> Reranker:
    """이름으로 Reranker 인스턴스 조회. 알 수 없는 이름은 KeyError."""
    if name in _INSTANCES:
        return _INSTANCES[name]

    if name == "gemini-flash":
        from src.search.rerank.gemini import GeminiReranker
        instance: Reranker = GeminiReranker()
    else:
        raise KeyError(f"Unknown reranker: {name!r}")

    _INSTANCES[name] = instance
    return instance


def _reset_instances_for_tests() -> None:
    """테스트 격리용. 운영 코드에서는 호출 금지."""
    _INSTANCES.clear()
