"""선행 #5 품질 기준선 수집 스크립트 단위 테스트."""
from __future__ import annotations

import pytest

from scripts.quality_baseline_collect import (
    BaselineQuestion,
    load_catalog,
    CATALOG_PATH,
)


def test_catalog_file_exists():
    assert CATALOG_PATH.exists(), f"{CATALOG_PATH} 가 필요합니다."


def test_catalog_entries_parse_as_baseline_question():
    items = load_catalog(CATALOG_PATH)
    assert len(items) >= 10
    for item in items:
        assert isinstance(item, BaselineQuestion)
        assert item.id.startswith("bq-")
        assert item.query.strip()
        assert item.category in {"doctrine", "practice", "adversarial", "out_of_scope", "variation"}


def test_catalog_ids_are_unique():
    items = load_catalog(CATALOG_PATH)
    ids = [item.id for item in items]
    assert len(ids) == len(set(ids))


def test_catalog_queries_are_unique():
    items = load_catalog(CATALOG_PATH)
    queries = [item.query for item in items]
    assert len(queries) == len(set(queries))


def test_catalog_has_exactly_200_entries():
    items = load_catalog(CATALOG_PATH)
    assert len(items) == 200


def test_catalog_category_balance():
    items = load_catalog(CATALOG_PATH)
    by_cat: dict[str, int] = {}
    for item in items:
        by_cat[item.category] = by_cat.get(item.category, 0) + 1
    # 최소 각 카테고리 10건 이상 (balance 체크)
    for cat in ("doctrine", "practice", "adversarial", "out_of_scope"):
        assert by_cat.get(cat, 0) >= 10, f"카테고리 {cat} 건수 부족: {by_cat}"


from unittest.mock import AsyncMock, MagicMock  # noqa: E402


@pytest.mark.asyncio
async def test_call_chat_api_parses_response():
    """POST /chat 응답 JSON 을 CollectionResult 로 매핑."""
    from scripts.quality_baseline_collect import CollectionResult, call_chat_api

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "answer": "축복은 참부모님의 은혜로...",
        "sources": [{"volume_raw": "원리강론", "chunk_id": "abc"}],
        "session_id": "11111111-1111-1111-1111-111111111111",
        "message_id": "22222222-2222-2222-2222-222222222222",
    }
    fake_client = AsyncMock()
    fake_client.post.return_value = fake_response

    result = await call_chat_api(
        fake_client,
        api_base="http://test",
        question=BaselineQuestion(id="bq-001", query="Q", category="doctrine", source="x"),
    )

    assert isinstance(result, CollectionResult)
    assert result.id == "bq-001"
    assert result.status_code == 200
    assert result.answer.startswith("축복")
    assert result.citations_count == 1
    assert result.session_id == "11111111-1111-1111-1111-111111111111"
    fake_client.post.assert_awaited_once()
    called_url = fake_client.post.call_args.args[0]
    assert called_url.endswith("/chat")


@pytest.mark.asyncio
async def test_call_chat_api_records_failure_status():
    from scripts.quality_baseline_collect import call_chat_api

    fake_response = MagicMock()
    fake_response.status_code = 429
    fake_response.text = "rate limit"
    fake_client = AsyncMock()
    fake_client.post.return_value = fake_response

    result = await call_chat_api(
        fake_client,
        api_base="http://test",
        question=BaselineQuestion(id="bq-002", query="Q", category="doctrine", source="x"),
    )
    assert result.status_code == 429
    assert result.answer == ""
    assert result.citations_count == 0
    assert "rate limit" in result.error


def test_parse_args_execute_requires_api_base():
    from scripts.quality_baseline_collect import _parse_args

    with pytest.raises(SystemExit):
        _parse_args(["--execute"])


def test_parse_args_dry_run_defaults():
    from scripts.quality_baseline_collect import _parse_args

    ns = _parse_args(["--dry-run"])
    assert ns.dry_run is True
    assert ns.api_base is None
    # 운영 RATE_LIMIT 한도 (0.33 req/s) 안 보수적 default.
    assert ns.rate_per_sec == 0.3
    assert ns.limit is None


def test_parse_args_execute_full():
    from scripts.quality_baseline_collect import _parse_args

    ns = _parse_args([
        "--execute", "--api-base", "https://x.run.app",
        "--rate-per-sec", "2.0", "--limit", "50",
    ])
    assert ns.execute is True
    assert ns.api_base == "https://x.run.app"
    assert ns.rate_per_sec == 2.0
    assert ns.limit == 50
