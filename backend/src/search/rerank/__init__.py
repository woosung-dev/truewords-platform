"""Reranker swappable 인터페이스.

등록 키: ``gemini-flash`` (PR 1), ``bge-base`` / ``bge-ko`` (PR 4).
RetrievalConfig.reranker_model 의 Literal 키와 1:1 매핑.
import side-effect 회피를 위해 어댑터 모듈은 get_reranker() 내부에서 lazy import
(BGE 분기는 transformers + torch 를 끌고 들어오므로 미사용 시 비용 0 보장).
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
# PR 4 의 BGE CrossEncoder (~1.1GB) 가 메모리 중복 로드되지 않도록 미리 적용.
_INSTANCES: dict[str, Reranker] = {}


def get_reranker(name: str) -> Reranker:
    """이름으로 Reranker 인스턴스 조회. 알 수 없는 이름은 KeyError."""
    if name in _INSTANCES:
        return _INSTANCES[name]

    if name == "gemini-flash":
        from src.search.rerank.gemini import GeminiReranker
        instance: Reranker = GeminiReranker()
    elif name == "bge-base":
        from src.search.rerank.bge import BGEReranker
        instance = BGEReranker(
            model_name="BAAI/bge-reranker-v2-m3",
            registry_key="bge-base",
        )
    elif name == "bge-ko":
        from src.search.rerank.bge import BGEReranker
        instance = BGEReranker(
            model_name="dragonkue/bge-reranker-v2-m3-ko",
            registry_key="bge-ko",
        )
    else:
        raise KeyError(f"Unknown reranker: {name!r}")

    _INSTANCES[name] = instance
    return instance


def _reset_instances_for_tests() -> None:
    """테스트 격리용. 운영 코드에서는 호출 금지."""
    _INSTANCES.clear()
