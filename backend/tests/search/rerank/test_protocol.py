"""Reranker factory + 싱글톤 + Protocol 계약 테스트."""

import pytest

from src.search.rerank import _reset_instances_for_tests, get_reranker
from src.search.rerank.gemini import GeminiReranker


@pytest.fixture(autouse=True)
def _reset_factory():
    """각 테스트 격리. 모듈 전역 _INSTANCES 캐시 초기화."""
    _reset_instances_for_tests()
    yield
    _reset_instances_for_tests()


def test_get_reranker_returns_gemini_for_known_name():
    reranker = get_reranker("gemini-flash")
    assert isinstance(reranker, GeminiReranker)
    assert reranker.name == "gemini-flash"


def test_get_reranker_caches_instance():
    """싱글톤: 동일 키로 두 번 호출 시 같은 인스턴스."""
    a = get_reranker("gemini-flash")
    b = get_reranker("gemini-flash")
    assert a is b


def test_get_reranker_unknown_name_raises_keyerror():
    with pytest.raises(KeyError, match="Unknown reranker"):
        get_reranker("nonexistent-model")
