"""fallback_search 비동기 테스트."""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.search.fallback import fallback_search
from src.search.hybrid import SearchResult

# 패치 경로 상수
_SPARSE_PATCH = "src.search.fallback.embed_sparse_async"
_GENERATE_TEXT_PATCH = "src.search.fallback.generate_text"


def _make_result(text: str = "말씀", score: float = 0.3, source: str = "A") -> SearchResult:
    """테스트용 SearchResult 생성 헬퍼."""
    return SearchResult(
        text=text,
        volume="vol_001",
        chunk_index=0,
        score=score,
        source=source,
    )


def _make_point(text: str = "말씀", score: float = 0.3, source: str = "A") -> MagicMock:
    """테스트용 Qdrant point mock 생성 헬퍼."""
    point = MagicMock()
    point.payload = {"text": text, "volume": "vol_001", "chunk_index": 0, "source": source}
    point.score = score
    return point


@pytest.mark.asyncio
async def test_fallback_returns_none_when_results_exist():
    """원본 결과가 있으면 fallback을 수행하지 않고 fallback_type='none'을 반환한다."""
    client = AsyncMock()
    original = [_make_result("말씀 1", score=0.8)]

    results, fallback_type = await fallback_search(
        client=client,
        query="참부모님",
        original_results=original,
        dense_embedding=[0.1] * 10,
    )

    # client.query_points 호출 없음
    client.query_points.assert_not_called()
    assert results == original
    assert fallback_type == "none"


@pytest.mark.asyncio
async def test_fallback_relaxed_search_removes_source_filter():
    """원본 결과가 0건이면 source 필터 없이 전체 컬렉션을 재검색하고 fallback_type='relaxed'를 반환한다."""
    client = AsyncMock()
    point = _make_point("말씀 B", score=0.2, source="B")
    client.query_points.return_value = MagicMock(points=[point])

    with patch(_SPARSE_PATCH, new_callable=AsyncMock, return_value=([1, 2], [0.5, 0.3])):
        results, fallback_type = await fallback_search(
            client=client,
            query="원죄",
            original_results=[],
            dense_embedding=[0.1] * 10,
        )

    # query_points 한 번 호출, query_filter=None 으로 전달되었는지 확인
    client.query_points.assert_called_once()
    call_kwargs = client.query_points.call_args.kwargs
    assert call_kwargs.get("query_filter") is None

    assert fallback_type == "relaxed"
    assert len(results) == 1
    assert results[0].text == "말씀 B"
    assert results[0].source == "B"


@pytest.mark.asyncio
async def test_fallback_suggestions_when_relaxed_also_empty():
    """relaxed 검색도 0건이면 LLM 질문 제안을 시도하고 fallback_type='suggestions'를 반환한다."""
    client = AsyncMock()
    # relaxed 검색 결과도 빈 포인트 목록
    client.query_points.return_value = MagicMock(points=[])

    with (
        patch(_SPARSE_PATCH, new_callable=AsyncMock, return_value=([1], [0.5])),
        patch(_GENERATE_TEXT_PATCH, new_callable=AsyncMock, return_value='["질문1", "질문2", "질문3"]'),
    ):
        results, fallback_type = await fallback_search(
            client=client,
            query="존재하지않는주제",
            original_results=[],
            dense_embedding=[0.1] * 10,
        )

    assert fallback_type == "suggestions"
    assert results == []


@pytest.mark.asyncio
async def test_fallback_suggestions_returns_parsed_list():
    """_generate_suggestions가 LLM 응답을 JSON 배열로 파싱하여 리스트를 반환한다."""
    from src.search.fallback import _generate_suggestions

    expected = ["질문1", "질문2", "질문3"]
    with patch(
        _GENERATE_TEXT_PATCH,
        new_callable=AsyncMock,
        return_value=json.dumps(expected),
    ):
        result = await _generate_suggestions("참부모님은 누구인가요?")

    assert result == expected


@pytest.mark.asyncio
async def test_fallback_suggestions_graceful_on_llm_failure():
    """LLM 호출이 실패하면 예외를 전파하지 않고 빈 리스트를 반환한다."""
    from src.search.fallback import _generate_suggestions

    with patch(_GENERATE_TEXT_PATCH, new_callable=AsyncMock, side_effect=Exception("API 오류")):
        result = await _generate_suggestions("아무 질문")

    assert result == []


@pytest.mark.asyncio
async def test_fallback_score_threshold_filters_low_scores():
    """score_threshold 미만인 포인트는 relaxed 결과에서 제외된다."""
    client = AsyncMock()
    # score 0.15 (threshold 이상), 0.03 (threshold 미만) 두 포인트
    high_point = _make_point("좋은 말씀", score=0.15)
    low_point = _make_point("낮은 점수 말씀", score=0.03)
    client.query_points.return_value = MagicMock(points=[high_point, low_point])

    with patch(_SPARSE_PATCH, new_callable=AsyncMock, return_value=([1], [0.5])):
        results, fallback_type = await fallback_search(
            client=client,
            query="필터 테스트",
            original_results=[],
            dense_embedding=[0.1] * 10,
            score_threshold=0.05,
        )

    assert fallback_type == "relaxed"
    assert len(results) == 1
    assert results[0].text == "좋은 말씀"
    assert results[0].score == 0.15
