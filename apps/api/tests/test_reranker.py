"""Gemini LLM Re-ranking 비동기 테스트."""

import json
from pathlib import Path

import pytest
from unittest.mock import AsyncMock, patch
from app.modules.chat.trace import TraceCollector, current_trace
from app.modules.search.reranker import rerank
from app.modules.search.hybrid import SearchResult


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
    # Gemini가 JSON으로 점수를 반환
    gemini_response = json.dumps({"scores": [0.1, 0.9, 0.2]})

    with patch("app.modules.search.reranker.generate_text", new_callable=AsyncMock, return_value=gemini_response):
        reranked = await rerank("축복의 의미는?", results)

    assert reranked[0].volume == "vol_002"
    assert reranked[0].rerank_score == 0.9
    # 원본 retrieval score는 유지
    assert reranked[0].score == 0.70


@pytest.mark.asyncio
async def test_rerank_respects_top_k():
    results = _make_results()
    gemini_response = json.dumps({"scores": [0.1, 0.9, 0.5]})

    with patch("app.modules.search.reranker.generate_text", new_callable=AsyncMock, return_value=gemini_response):
        reranked = await rerank("질문", results, top_k=2)

    assert len(reranked) == 2


@pytest.mark.asyncio
async def test_rerank_empty_input():
    reranked = await rerank("질문", [])
    assert reranked == []


@pytest.mark.asyncio
async def test_rerank_single_result():
    results = [SearchResult(text="유일한 결과", volume="vol_001", chunk_index=0, score=0.80, source="A")]
    gemini_response = json.dumps({"scores": [0.95]})

    with patch("app.modules.search.reranker.generate_text", new_callable=AsyncMock, return_value=gemini_response):
        reranked = await rerank("질문", results)

    assert len(reranked) == 1
    assert reranked[0].rerank_score == 0.95
    assert reranked[0].score == 0.80


@pytest.mark.asyncio
async def test_rerank_graceful_degradation_on_api_failure():
    """Gemini API 실패 시 원본 결과를 그대로 반환해야 함."""
    results = _make_results()

    with patch("app.modules.search.reranker.generate_text", new_callable=AsyncMock, side_effect=Exception("API Error")):
        reranked = await rerank("질문", results)

    # 원본 결과 그대로 반환 (rerank_score 없음)
    assert len(reranked) == 3
    assert all(r.rerank_score is None for r in reranked)


@pytest.mark.asyncio
async def test_rerank_graceful_degradation_on_invalid_json():
    """Gemini가 잘못된 JSON을 반환하면 원본 결과 사용."""
    results = _make_results()

    with patch("app.modules.search.reranker.generate_text", new_callable=AsyncMock, return_value="이것은 JSON이 아닙니다"):
        reranked = await rerank("질문", results)

    assert len(reranked) == 3
    assert all(r.rerank_score is None for r in reranked)


# ---------------------------------------------------------------------------
# 실측 실패 출력 재현 — 자유 텍스트 JSON 이 깨지던 근본 원인과 trace 상태 분류
# ---------------------------------------------------------------------------

_RAW_FAILURES = json.loads(
    (Path(__file__).parent / "fixtures" / "rerank_gemini_raw_failures.json").read_text(encoding="utf-8")
)["cases"]


async def _rerank_with_trace(response=None, error=None) -> tuple[list[SearchResult], str | None]:
    """generate_text 응답(또는 예외)을 고정하고 rerank 결과와 trace 의 rerank 상태를 돌려준다."""
    results = _make_results()
    mock = AsyncMock(return_value=response, side_effect=error)
    collector = TraceCollector()
    token = current_trace.set(collector)
    try:
        with patch("app.modules.search.reranker.generate_text", mock):
            reranked = await rerank("질문", results)
    finally:
        current_trace.reset(token)
    status = collector.rerank.status if collector.rerank else None
    return reranked, status


@pytest.mark.asyncio
async def test_rerank_requests_json_mode_schema_with_exact_count():
    """근본 원인: 형식을 프롬프트로만 부탁하지 않고 JSON 모드 스키마로 형식·개수를 강제한다."""
    mock = AsyncMock(return_value=json.dumps({"scores": [0.1, 0.9, 0.2]}))
    with patch("app.modules.search.reranker.generate_text", mock):
        await rerank("질문", _make_results())

    schema = mock.call_args.kwargs["response_schema"]
    scores = schema["properties"]["scores"]
    assert schema["required"] == ["scores"]
    assert scores["type"] == "ARRAY" and scores["items"]["type"] == "NUMBER"
    assert scores["min_items"] == scores["max_items"] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("case", _RAW_FAILURES, ids=[c["id"] for c in _RAW_FAILURES])
async def test_real_malformed_outputs_are_parse_fail_and_keep_original_order(case):
    """실측 실패 출력은 parse_fail 로 기록하고 원래 순서를 그대로 쓴다(점수 배열만 온 경우 포함)."""
    reranked, status = await _rerank_with_trace(response=case["raw"])

    assert status == "parse_fail"
    assert [r.volume for r in reranked] == ["vol_001", "vol_002", "vol_003"]
    assert all(r.rerank_score is None for r in reranked)


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [None, "null", '"scores"', '{"scores": 0.5}'])
async def test_non_object_or_empty_responses_are_parse_fail(response):
    """빈 응답(text=None)·dict 가 아닌 JSON 도 호출 실패가 아니라 parse_fail 이다."""
    reranked, status = await _rerank_with_trace(response=response)

    assert status == "parse_fail"
    assert len(reranked) == 3 and all(r.rerank_score is None for r in reranked)


@pytest.mark.asyncio
async def test_api_exception_is_api_fail():
    reranked, status = await _rerank_with_trace(error=Exception("429 RESOURCE_EXHAUSTED"))

    assert status == "api_fail"
    assert [r.volume for r in reranked] == ["vol_001", "vol_002", "vol_003"]


@pytest.mark.asyncio
async def test_valid_scores_are_ok():
    reranked, status = await _rerank_with_trace(response=json.dumps({"scores": [0.1, 0.9, 0.2]}))

    assert status == "ok"
    assert reranked[0].volume == "vol_002"
