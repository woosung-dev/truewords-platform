"""Weighted Search 단위 테스트."""

import pytest
from unittest.mock import AsyncMock, patch

from src.search.hybrid import SearchResult


def _make_result(text, score, source):
    return SearchResult(text=text, volume="vol", chunk_index=0, score=score, source=source)


MOCK_DENSE = [0.1] * 1536
MOCK_SPARSE = ([0, 1, 2], [0.5, 0.3, 0.2])


@pytest.fixture(autouse=True)
def _mock_embeddings():
    with (
        patch("src.search.weighted.embed_dense_query", new_callable=AsyncMock, return_value=MOCK_DENSE),
        patch("src.search.weighted.embed_sparse_async", new_callable=AsyncMock, return_value=MOCK_SPARSE),
    ):
        yield


@pytest.mark.asyncio
async def test_basic_3_sources():
    """3개 소스 (A:5, B:3, C:2) — 가중 점수 기준 정렬, raw score 유지."""
    from src.search.weighted import weighted_search, WeightedConfig, WeightedSource

    config = WeightedConfig(sources=[
        WeightedSource(source="A", weight=5.0, score_threshold=0.0),
        WeightedSource(source="B", weight=3.0, score_threshold=0.0),
        WeightedSource(source="C", weight=2.0, score_threshold=0.0),
    ])

    # A: score 0.3, B: score 0.4, C: score 0.5
    # weighted: A=0.3*(5/10)=0.15, B=0.4*(3/10)=0.12, C=0.5*(2/10)=0.10
    async def fake_hybrid(client, query, top_k, source_filter, dense_embedding, sparse_embedding, **kwargs):
        src = source_filter[0]
        if src == "A":
            return [_make_result("a1", 0.3, "A")]
        elif src == "B":
            return [_make_result("b1", 0.4, "B")]
        else:
            return [_make_result("c1", 0.5, "C")]

    with patch("src.search.weighted.hybrid_search", side_effect=fake_hybrid):
        results = await weighted_search(client=None, query="test", config=config, top_k=10)

    assert len(results) == 3
    # 가중 점수 기준 정렬: A(0.15) > B(0.12) > C(0.10)
    assert results[0].source == "A"
    assert results[1].source == "B"
    assert results[2].source == "C"
    # raw score 유지
    assert results[0].score == 0.3
    assert results[1].score == 0.4
    assert results[2].score == 0.5


@pytest.mark.asyncio
async def test_score_threshold_filters_before_weight():
    """threshold=0.15인 소스 A에서 score 0.1인 결과는 필터링."""
    from src.search.weighted import weighted_search, WeightedConfig, WeightedSource

    config = WeightedConfig(sources=[
        WeightedSource(source="A", weight=5.0, score_threshold=0.15),
    ])

    async def fake_hybrid(client, query, top_k, source_filter, dense_embedding, sparse_embedding, **kwargs):
        return [
            _make_result("low", 0.1, "A"),   # threshold 미달 → 필터
            _make_result("high", 0.2, "A"),   # 통과
        ]

    with patch("src.search.weighted.hybrid_search", side_effect=fake_hybrid):
        results = await weighted_search(client=None, query="test", config=config, top_k=10)

    assert len(results) == 1
    assert results[0].text == "high"


@pytest.mark.asyncio
async def test_source_failure_isolation():
    """소스 A 실패 시 B 결과만 반환 (격리)."""
    from src.search.weighted import weighted_search, WeightedConfig, WeightedSource

    config = WeightedConfig(sources=[
        WeightedSource(source="A", weight=1.0, score_threshold=0.0),
        WeightedSource(source="B", weight=1.0, score_threshold=0.0),
    ])

    call_count = 0

    async def fake_hybrid(client, query, top_k, source_filter, dense_embedding, sparse_embedding, **kwargs):
        nonlocal call_count
        call_count += 1
        if source_filter[0] == "A":
            raise Exception("Qdrant timeout")
        return [_make_result("b1", 0.5, "B")]

    with patch("src.search.weighted.hybrid_search", side_effect=fake_hybrid):
        results = await weighted_search(client=None, query="test", config=config, top_k=10)

    assert len(results) == 1
    assert results[0].source == "B"


@pytest.mark.asyncio
async def test_all_sources_zero_results():
    """모든 소스가 빈 결과 → 빈 리스트 반환 (예외 없음)."""
    from src.search.weighted import weighted_search, WeightedConfig, WeightedSource

    config = WeightedConfig(sources=[
        WeightedSource(source="A", weight=1.0),
        WeightedSource(source="B", weight=1.0),
    ])

    async def fake_hybrid(client, query, top_k, source_filter, dense_embedding, sparse_embedding, **kwargs):
        return []

    with patch("src.search.weighted.hybrid_search", side_effect=fake_hybrid):
        results = await weighted_search(client=None, query="test", config=config, top_k=10)

    assert results == []


@pytest.mark.asyncio
async def test_single_source():
    """단일 소스 (weight=1)."""
    from src.search.weighted import weighted_search, WeightedConfig, WeightedSource

    config = WeightedConfig(sources=[
        WeightedSource(source="A", weight=1.0, score_threshold=0.0),
    ])

    async def fake_hybrid(client, query, top_k, source_filter, dense_embedding, sparse_embedding, **kwargs):
        return [
            _make_result("a1", 0.5, "A"),
            _make_result("a2", 0.3, "A"),
        ]

    with patch("src.search.weighted.hybrid_search", side_effect=fake_hybrid):
        results = await weighted_search(client=None, query="test", config=config, top_k=10)

    assert len(results) == 2
    assert results[0].score == 0.5
    assert results[1].score == 0.3


@pytest.mark.asyncio
async def test_empty_config():
    """소스 없음 → 빈 리스트."""
    from src.search.weighted import weighted_search, WeightedConfig

    config = WeightedConfig(sources=[])
    results = await weighted_search(client=None, query="test", config=config, top_k=10)
    assert results == []


@pytest.mark.asyncio
async def test_weighted_logs_score_distribution(caplog):
    """Phase 0 분포 로깅: 결과 있을 때 weighted_score_dist 가 emit 되며 핵심 분포 통계 포함."""
    import logging

    from src.search.weighted import weighted_search, WeightedConfig, WeightedSource

    config = WeightedConfig(sources=[
        WeightedSource(source="A", weight=1.0, score_threshold=0.1),
    ])

    async def fake_hybrid(client, query, top_k, source_filter, dense_embedding, sparse_embedding, **kwargs):
        return [
            _make_result("a1", 0.45, "A"),
            _make_result("a2", 0.20, "A"),
            _make_result("a3", 0.05, "A"),
        ]

    with (
        patch("src.search.weighted.hybrid_search", side_effect=fake_hybrid),
        caplog.at_level(logging.INFO, logger="src.search.weighted"),
    ):
        await weighted_search(client=None, query="test", config=config, top_k=10)

    dist_logs = [r for r in caplog.records if r.message == "weighted_score_dist"]
    assert len(dist_logs) == 1
    record = dist_logs[0]
    assert record.source == "A"
    assert record.threshold == 0.1
    assert record.score_top == 0.45
    assert record.score_bottom == 0.05
    assert record.n_results == 3
    # 0.45, 0.20 통과 / 0.05 컷오프
    assert record.n_qualified == 2


@pytest.mark.asyncio
async def test_non_integer_weights():
    """비정수 가중치 (0.7, 0.3) — 동일 점수일 때 가중치 높은 소스 우선."""
    from src.search.weighted import weighted_search, WeightedConfig, WeightedSource

    config = WeightedConfig(sources=[
        WeightedSource(source="A", weight=0.7, score_threshold=0.0),
        WeightedSource(source="B", weight=0.3, score_threshold=0.0),
    ])

    async def fake_hybrid(client, query, top_k, source_filter, dense_embedding, sparse_embedding, **kwargs):
        src = source_filter[0]
        return [_make_result(f"{src.lower()}1", 0.5, src)]

    with patch("src.search.weighted.hybrid_search", side_effect=fake_hybrid):
        results = await weighted_search(client=None, query="test", config=config, top_k=10)

    assert len(results) == 2
    # 동일 score(0.5)지만 A(0.7/1.0)가 B(0.3/1.0)보다 가중 점수 높음
    assert results[0].source == "A"
    assert results[1].source == "B"
