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


def test_get_reranker_bge_keys_unregistered_in_pr1():
    """Literal 에 정의되어 있어도 PR 4 머지 전까진 미등록."""
    with pytest.raises(KeyError):
        get_reranker("bge-base")
    with pytest.raises(KeyError):
        get_reranker("bge-ko")
