"""여러 카테고리 검색 결과를 합치는 중간 계층.

한 chunk 가 여러 카테고리 태그(예: ``["M", "U"]``)를 갖는 것은 의도된 자유도라 유지한다.
대신 카테고리별 검색 결과를 합칠 때 같은 chunk 가 두 번 들어가지 않게 여기서 한 번만 거른다.
인접 chunk(다른 chunk_index, 텍스트 일부 겹침)는 서로 다른 point 라 거르지 않는다.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import replace

from app.modules.search.hybrid import SearchResult


def merge_unique_results(
    groups: Iterable[tuple[Sequence[str], Sequence[SearchResult]]],
    weights: Mapping[str, float] | None = None,
) -> list[SearchResult]:
    """카테고리별 검색 결과를 ``(volume, chunk_index)`` 기준 한 번씩만 남기고 정렬한다.

    Args:
        groups: ``(그 검색에 쓴 카테고리 목록, 그 검색의 결과)`` 목록. 우선순위 순서.
        weights: 카테고리별 정규화 가중치(weighted). None 이면 cascading 방식.

    Returns:
        점수 내림차순 목록. top_k 자르기는 호출부가 한다(trace 가 자르기 전 목록을 남긴다).

    - weighted: 가중 점수(raw score × 찾아 준 카테고리 중 최대 가중치)가 가장 높은 결과를
      남기고 그 가중 점수로 정렬한다.
    - cascading: 먼저 담긴 쪽(앞 tier)을 남기고 raw score 로 정렬한다.
    - 남긴 결과의 ``matched_sources`` 에 이 chunk 를 찾아 준 카테고리를 모두 적는다.
    """
    best: dict[tuple[str, int], tuple[float, SearchResult]] = {}
    matched: dict[tuple[str, int], set[str]] = {}
    for searched, results in groups:
        for r in results:
            tags = r.tags or ((r.source,) if r.source else ())
            hits = {s for s in searched if s in tags}
            key = (r.volume, r.chunk_index)
            matched.setdefault(key, set()).update(hits)
            if weights is None:
                if key not in best:
                    best[key] = (r.score, r)
                continue
            score = r.score * max((weights.get(s, 0.0) for s in hits), default=0.0)
            if key not in best or score > best[key][0]:
                best[key] = (score, r)

    ranked = sorted(best.items(), key=lambda item: item[1][0], reverse=True)
    merged: list[SearchResult] = []
    for key, (_score, r) in ranked:
        tags = r.tags or ((r.source,) if r.source else ())
        merged.append(replace(r, matched_sources=tuple(s for s in tags if s in matched[key])))
    return merged
