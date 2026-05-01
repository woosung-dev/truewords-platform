"""GeminiReranker 어댑터 비동기 테스트.

기존 backend/tests/test_reranker.py 의 6 케이스를 어댑터 호출 방식으로 이전 + name 속성 1.
"""

import json

import pytest
from unittest.mock import AsyncMock, patch
from src.search.rerank.gemini import GeminiReranker
from src.search.hybrid import SearchResult


def _make_results() -> list[SearchResult]:
    return [
        SearchResult(text="관련성 낮은 문장", volume="vol_001", chunk_index=0, score=0.95, source="A"),
        SearchResult(text="축복의 참된 의미는 참부모님으로부터", volume="vol_002", chunk_index=1, score=0.70, source="A"),
        SearchResult(text="완전히 무관한 내용", volume="vol_003", chunk_index=2, score=0.85, source="B"),
    ]


@pytest.mark.asyncio
async def test_rerank_returns_reordered_results():
    """Gemini 점수 기반으로 재정렬되어야 함."""
    results = _make_results()
    gemini_response = json.dumps({"scores": [0.1, 0.9, 0.2]})

    with patch("src.search.rerank.gemini.generate_text", new_callable=AsyncMock, return_value=gemini_response):
        reranked = await GeminiReranker().rerank("축복의 의미는?", results)

    assert reranked[0].volume == "vol_002"
    assert reranked[0].rerank_score == 0.9
    # 원본 retrieval score는 유지
    assert reranked[0].score == 0.70


@pytest.mark.asyncio
async def test_rerank_respects_top_k():
    results = _make_results()
    gemini_response = json.dumps({"scores": [0.1, 0.9, 0.5]})

    with patch("src.search.rerank.gemini.generate_text", new_callable=AsyncMock, return_value=gemini_response):
        reranked = await GeminiReranker().rerank("질문", results, top_k=2)

    assert len(reranked) == 2


@pytest.mark.asyncio
async def test_rerank_empty_input():
    reranked = await GeminiReranker().rerank("질문", [])
    assert reranked == []


@pytest.mark.asyncio
async def test_rerank_single_result():
    results = [SearchResult(text="유일한 결과", volume="vol_001", chunk_index=0, score=0.80, source="A")]
    gemini_response = json.dumps({"scores": [0.95]})

    with patch("src.search.rerank.gemini.generate_text", new_callable=AsyncMock, return_value=gemini_response):
        reranked = await GeminiReranker().rerank("질문", results)

    assert len(reranked) == 1
    assert reranked[0].rerank_score == 0.95
    assert reranked[0].score == 0.80


@pytest.mark.asyncio
async def test_rerank_graceful_degradation_on_api_failure():
    """Gemini API 실패 시 원본 결과를 그대로 반환해야 함."""
    results = _make_results()

    with patch("src.search.rerank.gemini.generate_text", new_callable=AsyncMock, side_effect=Exception("API Error")):
        reranked = await GeminiReranker().rerank("질문", results)

    # 원본 결과 그대로 반환 (rerank_score 없음)
    assert len(reranked) == 3
    assert all(r.rerank_score is None for r in reranked)


@pytest.mark.asyncio
async def test_rerank_graceful_degradation_on_invalid_json():
    """Gemini가 잘못된 JSON을 반환하면 원본 결과 사용."""
    results = _make_results()

    with patch("src.search.rerank.gemini.generate_text", new_callable=AsyncMock, return_value="이것은 JSON이 아닙니다"):
        reranked = await GeminiReranker().rerank("질문", results)

    assert len(reranked) == 3
    assert all(r.rerank_score is None for r in reranked)


def test_reranker_name_attribute():
    """name 속성이 Protocol 계약 + RetrievalConfig.reranker_model default 와 일치."""
    assert GeminiReranker().name == "gemini-flash"
