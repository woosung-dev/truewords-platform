"""여러 카테고리 검색 결과 병합 — 같은 chunk(다중 태그 point) 중복 제거."""

from unittest.mock import AsyncMock, patch

import pytest

from app.modules.search.cascading import CascadingConfig, SearchTier, cascading_search
from app.modules.search.hybrid import SearchResult
from app.modules.search.weighted import WeightedConfig, WeightedSource, weighted_search


def _r(volume: str, chunk_index: int, score: float, tags: tuple[str, ...], text: str = "") -> SearchResult:
    """Qdrant point 변환 결과처럼 source 는 첫 태그, tags 는 태그 전체."""
    return SearchResult(
        text=text or f"{volume}-{chunk_index}",
        volume=volume,
        chunk_index=chunk_index,
        score=score,
        source=tags[0],
        tags=tags,
        chunk_id=f"{volume}:{chunk_index}",
    )


def _keys(results: list[SearchResult]) -> list[tuple[str, int]]:
    return [(r.volume, r.chunk_index) for r in results]


# ---- merge_unique_results ---------------------------------------------------


def test_multi_tag_point_from_two_searches_kept_once() -> None:
    from app.modules.search.merge import merge_unique_results

    shared_m = _r("천성경", 3267, 0.5, ("M", "U"))
    shared_u = _r("천성경", 3267, 0.4, ("M", "U"))
    merged = merge_unique_results(
        [(["M"], [shared_m, _r("m", 1, 0.3, ("M",))]), (["U"], [shared_u])],
        weights={"M": 1.0, "U": 1.0},
    )

    assert _keys(merged).count(("천성경", 3267)) == 1
    assert len(merged) == 2
    kept = next(r for r in merged if r.volume == "천성경")
    assert kept.matched_sources == ("M", "U")
    # 같은 비중이면 가중 점수가 높은 M 검색 결과를 남긴다.
    assert kept.score == 0.5


def test_weighted_merge_sorts_by_highest_matched_weight() -> None:
    """M 1, U 3 — U 검색으로도 잡힌 M·U chunk 는 U 비중으로 정렬된다."""
    from app.modules.search.merge import merge_unique_results

    weights = {"M": 0.25, "U": 0.75}
    merged = merge_unique_results(
        [
            (["M"], [_r("천성경", 3267, 0.5, ("M", "U")), _r("m", 1, 0.9, ("M",))]),
            (["U"], [_r("u", 1, 0.35, ("U",)), _r("천성경", 3267, 0.4, ("M", "U"))]),
        ],
        weights=weights,
    )

    # 천성경 0.4*0.75=0.30 > u 0.35*0.75=0.2625 > m 0.9*0.25=0.225
    assert _keys(merged) == [("천성경", 3267), ("u", 1), ("m", 1)]
    assert merged[0].score == 0.4
    assert merged[0].matched_sources == ("M", "U")


def test_merge_without_weights_keeps_first_group() -> None:
    from app.modules.search.merge import merge_unique_results

    merged = merge_unique_results(
        [(["A"], [_r("v", 1, 0.2, ("A", "B"))]), (["B"], [_r("v", 1, 0.9, ("A", "B"))])],
    )

    assert len(merged) == 1
    assert merged[0].score == 0.2
    assert merged[0].matched_sources == ("A", "B")


def test_adjacent_chunks_with_overlapping_text_are_both_kept() -> None:
    """인접 chunk 는 150자가 겹쳐도 서로 다른 point 라 둘 다 남는다."""
    from app.modules.search.merge import merge_unique_results

    overlap = "가" * 150
    merged = merge_unique_results(
        [(["M"], [_r("천성경", 10, 0.5, ("M",), "앞" + overlap), _r("천성경", 11, 0.4, ("M",), overlap + "뒤")])],
        weights={"M": 1.0},
    )

    assert _keys(merged) == [("천성경", 10), ("천성경", 11)]


# ---- weighted_search / cascading_search ------------------------------------


@pytest.fixture
def _no_embedding():
    with (
        patch("app.modules.search.weighted.embed_dense_query", new_callable=AsyncMock, return_value=[0.1]),
        patch("app.modules.search.weighted.embed_sparse_async", new_callable=AsyncMock, return_value=([1], [1.0])),
        patch("app.modules.search.cascading.embed_dense_query", new_callable=AsyncMock, return_value=[0.1]),
        patch("app.modules.search.cascading.embed_sparse_async", new_callable=AsyncMock, return_value=([1], [1.0])),
    ):
        yield


@pytest.mark.asyncio
@pytest.mark.usefixtures("_no_embedding")
async def test_weighted_search_has_no_duplicate_and_fills_slot_with_next() -> None:
    by_source = {
        "M": [_r("천성경", 3267, 0.5, ("M", "U")), _r("m", 1, 0.4, ("M",)), _r("m", 2, 0.2, ("M",))],
        "U": [_r("천성경", 3267, 0.45, ("M", "U")), _r("u", 1, 0.3, ("U",))],
    }

    async def fake_hybrid(client, query, top_k, source_filter, **kwargs):
        return by_source[source_filter[0]]

    config = WeightedConfig(sources=[WeightedSource("M", 1.0, 0.1), WeightedSource("U", 1.0, 0.1)])
    with patch("app.modules.search.weighted.hybrid_search", side_effect=fake_hybrid):
        results = await weighted_search(client=None, query="성혼식", config=config, top_k=4)

    keys = _keys(results)
    assert len(keys) == len(set(keys)) == 4
    # 중복이 빠진 자리는 다음 순위 문서(m:2)가 채운다.
    assert keys == [("천성경", 3267), ("m", 1), ("u", 1), ("m", 2)]
    assert results[0].matched_sources == ("M", "U")


@pytest.mark.asyncio
@pytest.mark.usefixtures("_no_embedding")
async def test_cascading_duplicate_does_not_inflate_min_results() -> None:
    """tier0(M) 결과를 tier1(U) 이 다시 돌려줘도 고유 문서 수로 판정해 tier2 까지 간다."""
    by_tier = {
        ("M",): [_r("천성경", 3267, 0.5, ("M", "U"))],
        ("U",): [_r("천성경", 3267, 0.9, ("M", "U"))],
        ("B",): [_r("b", 1, 0.3, ("B",))],
    }
    calls: list[tuple[str, ...]] = []

    async def fake_hybrid(client, query, top_k, source_filter, **kwargs):
        calls.append(tuple(source_filter))
        return by_tier[tuple(source_filter)]

    config = CascadingConfig(tiers=[
        SearchTier(sources=["M"], min_results=2, score_threshold=0.1),
        SearchTier(sources=["U"], min_results=2, score_threshold=0.1),
        SearchTier(sources=["B"], min_results=2, score_threshold=0.1),
    ])
    with patch("app.modules.search.cascading.hybrid_search", side_effect=fake_hybrid):
        results = await cascading_search(AsyncMock(), "질문", config, top_k=10)

    assert calls == [("M",), ("U",), ("B",)]
    assert _keys(results) == [("천성경", 3267), ("b", 1)]
    # 먼저 담긴 tier0 쪽 결과를 남긴다.
    assert results[0].score == 0.5
    assert results[0].matched_sources == ("M", "U")
