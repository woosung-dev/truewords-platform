"""match_snippets_to_chunks 단위 테스트 (PR 3 Part 2).

Qdrant 의존성을 mock 처리해 substring 매칭 / mid candidate 분기 / 다중 snippet
처리 / queries.json 갱신 정확성을 검증.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

# scripts/ 는 패키지가 아니므로 sys.path 조작
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from match_snippets_to_chunks import (  # noqa: E402
    match_all_queries,
    match_query_entry,
    normalize_text,
)
from src.search.hybrid import SearchResult  # noqa: E402


def _result(text: str, volume: str, chunk_index: int, score: float = 0.5) -> SearchResult:
    return SearchResult(
        text=text, volume=volume, chunk_index=chunk_index,
        score=score, source="A",
    )


# ── normalize_text ─────────────────────────────────────────────────────────


def test_normalize_collapses_whitespace():
    assert normalize_text("hello\n  \tworld") == "hello world"


def test_normalize_strips():
    assert normalize_text("   abc  ") == "abc"


def test_normalize_preserves_korean():
    assert normalize_text("창조원리\n첫 단계") == "창조원리 첫 단계"


# ── match_query_entry: substring 매칭 ─────────────────────────────────────


@pytest.mark.asyncio
async def test_high_confidence_substring_match_returns_chunk_id():
    """snippet 이 chunk text 의 substring → high confidence chunk_id 추가."""
    query = {
        "id": "f01",
        "expected_snippets": [
            {"file": "원리강론.txt", "snippet": "장성기의 완성급에서 타락"}
        ],
    }
    fake_results = [
        _result("앞부분... 장성기의 완성급에서 타락하였던 것이다... 뒷부분", "원리강론", 42, 0.9),
    ]
    with patch(
        "match_snippets_to_chunks.search_for_snippet",
        new_callable=AsyncMock, return_value=fake_results,
    ):
        chunk_ids, mid = await match_query_entry(query, ["U"], top_k=20)

    assert chunk_ids == ["원리강론:42"]
    assert mid == []


@pytest.mark.asyncio
async def test_no_substring_match_falls_back_to_mid_candidate():
    """snippet 이 어떤 chunk 의 substring 도 아니면 → mid candidate 보고."""
    query = {
        "id": "f02",
        "expected_snippets": [
            {"file": "원리강론.txt", "snippet": "이 문장은 chunk text 와 다름"}
        ],
    }
    fake_results = [
        _result("완전히 다른 내용", "원리강론", 10, 0.5),
        _result("또 다른 내용", "원리강론", 11, 0.4),
    ]
    with patch(
        "match_snippets_to_chunks.search_for_snippet",
        new_callable=AsyncMock, return_value=fake_results,
    ):
        chunk_ids, mid = await match_query_entry(query, ["U"], top_k=20)

    assert chunk_ids == []
    assert len(mid) == 1
    assert mid[0]["candidate_chunk_id"] == "원리강론:10"
    assert mid[0]["candidate_score"] == 0.5
    assert mid[0]["snippet_preview"].startswith("이 문장")


@pytest.mark.asyncio
async def test_multiple_snippets_collect_distinct_chunk_ids():
    """query 가 2 snippet 가지고 각각 다른 chunk 매칭 → 둘 다 추가."""
    query = {
        "id": "r01",
        "expected_snippets": [
            {"file": "원리강론.txt", "snippet": "snippet A"},
            {"file": "천성경.pdf", "snippet": "snippet B"},
        ],
    }
    # 첫 호출: snippet A → chunk_001
    # 두번째 호출: snippet B → chunk_002
    side_effect = [
        [_result("앞... snippet A ...뒤", "원리강론", 1, 0.9)],
        [_result("앞... snippet B ...뒤", "천성경", 2, 0.85)],
    ]
    with patch(
        "match_snippets_to_chunks.search_for_snippet",
        new_callable=AsyncMock, side_effect=side_effect,
    ):
        chunk_ids, mid = await match_query_entry(query, ["U"], top_k=20)

    assert chunk_ids == ["원리강론:1", "천성경:2"]
    assert mid == []


@pytest.mark.asyncio
async def test_duplicate_chunk_id_deduped():
    """2 snippet 이 같은 chunk 매칭 → chunk_id 1번만."""
    query = {
        "id": "c01",
        "expected_snippets": [
            {"file": "원리강론.txt", "snippet": "키워드 X"},
            {"file": "원리강론.txt", "snippet": "키워드 Y"},
        ],
    }
    same_chunk = _result("앞... 키워드 X 그리고 키워드 Y ...뒤", "원리강론", 5, 0.9)
    with patch(
        "match_snippets_to_chunks.search_for_snippet",
        new_callable=AsyncMock, return_value=[same_chunk],
    ):
        chunk_ids, mid = await match_query_entry(query, ["U"], top_k=20)

    assert chunk_ids == ["원리강론:5"]


@pytest.mark.asyncio
async def test_substring_match_handles_whitespace_normalization():
    """chunk 에 줄바꿈/탭 있어도 normalize 후 substring 일치."""
    query = {
        "id": "f03",
        "expected_snippets": [
            {"file": "천성경.pdf", "snippet": "참사랑은 위하는 데서부터"}
        ],
    }
    # chunk text 안에 줄바꿈이 들어있는 경우
    fake_results = [
        _result("앞부분\n참사랑은\t위하는 데서부터 시작된다\n뒷부분", "천성경", 7, 0.8),
    ]
    with patch(
        "match_snippets_to_chunks.search_for_snippet",
        new_callable=AsyncMock, return_value=fake_results,
    ):
        chunk_ids, mid = await match_query_entry(query, ["U"], top_k=20)

    assert chunk_ids == ["천성경:7"]


@pytest.mark.asyncio
async def test_empty_snippet_skipped():
    """빈 snippet 은 skip (검색 안 함)."""
    query = {
        "id": "f04",
        "expected_snippets": [
            {"file": "원리강론.txt", "snippet": ""},
            {"file": "원리강론.txt", "snippet": "valid snippet"},
        ],
    }
    fake_results = [_result("앞 valid snippet 뒤", "원리강론", 99, 0.9)]
    with patch(
        "match_snippets_to_chunks.search_for_snippet",
        new_callable=AsyncMock, return_value=fake_results,
    ) as mock_search:
        chunk_ids, mid = await match_query_entry(query, ["U"], top_k=20)

    # 빈 snippet 은 search 호출 0번, valid 만 1번
    assert mock_search.await_count == 1
    assert chunk_ids == ["원리강론:99"]


# ── match_all_queries: queries.json round-trip ────────────────────────────


def _minimal_queries_json() -> dict[str, Any]:
    return {
        "version": 2,
        "intended_chatbot": "신학/원리 전문 봇",
        "intended_sources": ["U"],
        "queries": [
            {
                "id": "f01", "category": "factoid",
                "query": "Q1?", "answer_summary": "A1",
                "expected_snippets": [
                    {"file": "원리강론.txt", "snippet": "키워드 ABC"}
                ],
                "expected_chunk_ids": [], "expected_volumes": [], "notes": "",
            },
            {
                "id": "f02", "category": "factoid",
                "query": "Q2?", "answer_summary": "A2",
                "expected_snippets": [
                    {"file": "원리강론.txt", "snippet": "매칭 안 되는 내용"}
                ],
                "expected_chunk_ids": [], "expected_volumes": [], "notes": "",
            },
        ],
    }


@pytest.mark.asyncio
async def test_match_all_queries_writes_chunk_ids_and_bumps_version(tmp_path):
    queries_path = tmp_path / "queries.json"
    queries_path.write_text(json.dumps(_minimal_queries_json()), encoding="utf-8")

    side_effect = [
        # Q1: substring match
        [_result("앞 키워드 ABC 뒤", "원리강론", 100, 0.9)],
        # Q2: no substring match
        [_result("완전히 다른 내용", "원리강론", 200, 0.5)],
    ]
    with patch(
        "match_snippets_to_chunks.search_for_snippet",
        new_callable=AsyncMock, side_effect=side_effect,
    ):
        report = await match_all_queries(queries_path, ["U"], top_k=20, dry_run=False)

    assert report["n_queries"] == 2
    assert report["n_high_confidence"] == 1
    assert report["n_no_match"] == 1

    saved = json.loads(queries_path.read_text(encoding="utf-8"))
    assert saved["version"] == 3  # 2 → 3
    f01 = next(q for q in saved["queries"] if q["id"] == "f01")
    f02 = next(q for q in saved["queries"] if q["id"] == "f02")
    assert f01["expected_chunk_ids"] == ["원리강론:100"]
    assert f02["expected_chunk_ids"] == []


@pytest.mark.asyncio
async def test_match_all_queries_dry_run_does_not_write(tmp_path):
    queries_path = tmp_path / "queries.json"
    original = _minimal_queries_json()
    queries_path.write_text(json.dumps(original), encoding="utf-8")

    side_effect = [
        [_result("앞 키워드 ABC 뒤", "원리강론", 100, 0.9)],
        [_result("다른 내용", "원리강론", 200, 0.5)],
    ]
    with patch(
        "match_snippets_to_chunks.search_for_snippet",
        new_callable=AsyncMock, side_effect=side_effect,
    ):
        await match_all_queries(queries_path, ["U"], top_k=20, dry_run=True)

    saved = json.loads(queries_path.read_text(encoding="utf-8"))
    assert saved["version"] == original["version"]  # bump 안 됨
    for q in saved["queries"]:
        assert q["expected_chunk_ids"] == []
