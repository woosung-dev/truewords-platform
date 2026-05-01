"""Reranker factory + 싱글톤 + Protocol 계약 테스트."""

import pytest

from src.search.rerank import _reset_instances_for_tests, get_reranker
from src.search.rerank.bge import BGEReranker
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


def test_get_reranker_bge_base_returns_bge_instance():
    """PR 4 — bge-base 키가 BGEReranker 로 등록되어 있어야 함."""
    inst = get_reranker("bge-base")
    assert isinstance(inst, BGEReranker)
    assert inst.name == "bge-base"


def test_get_reranker_bge_ko_returns_bge_instance():
    """PR 4 — bge-ko 키가 BGEReranker 로 등록되어 있어야 함."""
    inst = get_reranker("bge-ko")
    assert isinstance(inst, BGEReranker)
    assert inst.name == "bge-ko"


def test_get_reranker_bge_caches_singleton():
    """PR 4 — BGE 도 싱글톤 캐싱. 모델 1.1GB 중복 로드 방지."""
    a = get_reranker("bge-base")
    b = get_reranker("bge-base")
    assert a is b


def test_get_reranker_bge_base_and_ko_are_distinct_instances():
    """서로 다른 키는 별개 인스턴스 (모델 이름이 다름)."""
    base = get_reranker("bge-base")
    ko = get_reranker("bge-ko")
    assert base is not ko
    assert base.name != ko.name
