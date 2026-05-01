"""BGE cross-encoder reranker 단위 테스트.

CrossEncoder.predict 는 mock 으로 차단 — 실 모델 다운로드 회피 (~1.1GB × 2).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from src.search.hybrid import SearchResult
from src.search.rerank.bge import BGEReranker


def _make_results() -> list[SearchResult]:
    return [
        SearchResult(text="A 텍스트", volume="vol_001", chunk_index=1, score=0.5, source="A"),
        SearchResult(text="B 텍스트", volume="vol_002", chunk_index=2, score=0.7, source="A"),
        SearchResult(text="C 텍스트", volume="vol_003", chunk_index=3, score=0.3, source="A"),
    ]


def _patch_crossencoder(predict_return):
    """CrossEncoder 클래스를 mock 으로 교체. predict 는 동기 함수처럼 동작."""
    instance = MagicMock()
    instance.predict = MagicMock(return_value=predict_return)
    return patch("src.search.rerank.bge.CrossEncoder", return_value=instance)


@pytest.mark.asyncio
async def test_bge_rerank_returns_reordered_results():
    """BGE 점수 기반 재정렬 검증."""
    reranker = BGEReranker(model_name="dummy/model", registry_key="bge-base")

    with _patch_crossencoder(predict_return=[0.1, 0.9, 0.2]):
        reranked = await reranker.rerank("질문", _make_results())

    assert reranked[0].volume == "vol_002"
    assert reranked[0].rerank_score == pytest.approx(0.9)
    assert reranked[1].volume == "vol_003"
    assert reranked[2].volume == "vol_001"


@pytest.mark.asyncio
async def test_bge_preserves_original_score():
    """원본 retrieval score 는 변경되지 않아야 함."""
    reranker = BGEReranker(model_name="dummy/model", registry_key="bge-base")

    with _patch_crossencoder(predict_return=[0.1, 0.9, 0.2]):
        reranked = await reranker.rerank("질문", _make_results())

    top = reranked[0]
    assert top.score == pytest.approx(0.7)  # 원본 RRF score 유지
    assert top.rerank_score == pytest.approx(0.9)


@pytest.mark.asyncio
async def test_bge_respects_top_k():
    """top_k=2 → 상위 2개만 반환."""
    reranker = BGEReranker(model_name="dummy/model", registry_key="bge-base")

    with _patch_crossencoder(predict_return=[0.1, 0.9, 0.2]):
        reranked = await reranker.rerank("질문", _make_results(), top_k=2)

    assert len(reranked) == 2
    assert reranked[0].volume == "vol_002"
    assert reranked[1].volume == "vol_003"


@pytest.mark.asyncio
async def test_bge_empty_results_short_circuits():
    """빈 입력 → 빈 출력, 모델 로드도 호출되지 않음."""
    reranker = BGEReranker(model_name="dummy/model", registry_key="bge-base")

    with patch("src.search.rerank.bge.CrossEncoder") as mock_cls:
        reranked = await reranker.rerank("질문", [])

    assert reranked == []
    mock_cls.assert_not_called()


@pytest.mark.asyncio
async def test_bge_lazy_loads_model_only_once():
    """동일 인스턴스로 두 번 호출 시 CrossEncoder 는 1회만 인스턴스화."""
    reranker = BGEReranker(model_name="dummy/model", registry_key="bge-base")

    with _patch_crossencoder(predict_return=[0.1, 0.9, 0.2]) as p:
        await reranker.rerank("질문 1", _make_results())
        await reranker.rerank("질문 2", _make_results())

    assert p.call_count == 1


@pytest.mark.asyncio
async def test_bge_graceful_degradation_on_load_failure():
    """모델 로드 실패 → 원본 결과를 rerank_score=None 으로 반환 (graceful)."""
    reranker = BGEReranker(model_name="dummy/model", registry_key="bge-base")
    results = _make_results()

    with patch("src.search.rerank.bge.CrossEncoder", side_effect=RuntimeError("download failed")):
        reranked = await reranker.rerank("질문", results)

    assert len(reranked) == 3
    assert all(r.rerank_score is None for r in reranked)
    # 정렬도 변하지 않음 (원본 순서 보존)
    assert [r.volume for r in reranked] == ["vol_001", "vol_002", "vol_003"]


@pytest.mark.asyncio
async def test_bge_graceful_degradation_on_predict_failure():
    """predict 실패 → 원본 반환."""
    reranker = BGEReranker(model_name="dummy/model", registry_key="bge-base")
    results = _make_results()

    instance = MagicMock()
    instance.predict = MagicMock(side_effect=ValueError("inference broken"))
    with patch("src.search.rerank.bge.CrossEncoder", return_value=instance):
        reranked = await reranker.rerank("질문", results)

    assert len(reranked) == 3
    assert all(r.rerank_score is None for r in reranked)


@pytest.mark.asyncio
async def test_bge_graceful_degradation_respects_top_k():
    """graceful 경로에서도 top_k 슬라이싱 적용 — gemini.py 일관성."""
    reranker = BGEReranker(model_name="dummy/model", registry_key="bge-base")

    with patch("src.search.rerank.bge.CrossEncoder", side_effect=RuntimeError("boom")):
        reranked = await reranker.rerank("질문", _make_results(), top_k=2)

    assert len(reranked) == 2
    assert all(r.rerank_score is None for r in reranked)


def test_bge_name_attribute_matches_registry_key():
    """Protocol 의 name 속성은 registry key 와 일치."""
    base = BGEReranker(model_name="BAAI/bge-reranker-v2-m3", registry_key="bge-base")
    ko = BGEReranker(model_name="dragonkue/bge-reranker-v2-m3-ko", registry_key="bge-ko")

    assert base.name == "bge-base"
    assert ko.name == "bge-ko"
