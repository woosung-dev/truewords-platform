"""선행 #3 Qdrant schema drift probe 단위 테스트."""
from __future__ import annotations

import pytest
from qdrant_client.models import PayloadSchemaType

from scripts.qdrant_schema_drift_probe import (
    EXPECTED_MAIN_SCHEMA,
    EXPECTED_CACHE_SCHEMA,
    DriftReport,
    compare_schemas,
    load_expected_schema,
)


def test_expected_main_schema_has_source_and_volume_keyword():
    """운영 주 컬렉션은 source/volume KEYWORD 2개가 최소 인덱스."""
    schema = load_expected_schema("main")
    assert schema["source"] == PayloadSchemaType.KEYWORD
    assert schema["volume"] == PayloadSchemaType.KEYWORD


def test_expected_cache_schema_has_chatbot_id_keyword():
    """Cache 컬렉션은 chatbot_id KEYWORD 를 포함."""
    schema = load_expected_schema("cache")
    assert schema["chatbot_id"] == PayloadSchemaType.KEYWORD


def test_compare_schemas_detects_missing_field():
    expected = {"source": PayloadSchemaType.KEYWORD, "volume": PayloadSchemaType.KEYWORD}
    actual = {"source": PayloadSchemaType.KEYWORD}
    report = compare_schemas("malssum_poc_staging", expected, actual)
    assert report.missing_in_target == ["volume"]
    assert report.is_drift is True


def test_compare_schemas_detects_extra_field():
    expected = {"source": PayloadSchemaType.KEYWORD}
    actual = {"source": PayloadSchemaType.KEYWORD, "legacy_field": PayloadSchemaType.INTEGER}
    report = compare_schemas("malssum_poc_staging", expected, actual)
    assert report.extra_in_target == ["legacy_field"]
    assert report.is_drift is True


def test_compare_schemas_detects_type_mismatch():
    expected = {"volume": PayloadSchemaType.KEYWORD}
    actual = {"volume": PayloadSchemaType.TEXT}
    report = compare_schemas("malssum_poc_staging", expected, actual)
    assert report.type_mismatch == [("volume", "keyword", "text")]
    assert report.is_drift is True


def test_compare_schemas_no_drift_when_equal():
    expected = {"source": PayloadSchemaType.KEYWORD}
    actual = {"source": PayloadSchemaType.KEYWORD}
    report = compare_schemas("malssum_poc_staging", expected, actual)
    assert report.is_drift is False
    assert report.missing_in_target == []
    assert report.extra_in_target == []
    assert report.type_mismatch == []


from unittest.mock import AsyncMock, MagicMock  # noqa: E402


@pytest.mark.asyncio
async def test_fetch_actual_schema_parses_payload_schema():
    """AsyncQdrantClient.get_collection 응답을 SchemaDict 로 변환."""
    from scripts.qdrant_schema_drift_probe import fetch_actual_schema

    fake_info = MagicMock()
    fake_info.payload_schema = {
        "source": MagicMock(data_type=PayloadSchemaType.KEYWORD),
        "volume": MagicMock(data_type=PayloadSchemaType.KEYWORD),
    }
    client = AsyncMock()
    client.get_collection.return_value = fake_info

    actual = await fetch_actual_schema(client, "malssum_poc")

    assert actual == {
        "source": PayloadSchemaType.KEYWORD,
        "volume": PayloadSchemaType.KEYWORD,
    }
    client.get_collection.assert_awaited_once_with("malssum_poc")


def test_parse_args_requires_mode():
    from scripts.qdrant_schema_drift_probe import _parse_args

    with pytest.raises(SystemExit):
        _parse_args([])


def test_parse_args_dry_run_defaults():
    from scripts.qdrant_schema_drift_probe import _parse_args

    ns = _parse_args(["--dry-run"])
    assert ns.dry_run is True
    assert ns.execute is False
    assert ns.main == "malssum_poc_staging"
    assert ns.cache == "semantic_cache_staging"


def test_parse_args_execute_with_custom_report():
    from scripts.qdrant_schema_drift_probe import _parse_args

    ns = _parse_args(["--execute", "--report", "out.json", "--main", "X", "--cache", "Y"])
    assert ns.execute is True
    assert str(ns.report) == "out.json"
    assert ns.main == "X"
    assert ns.cache == "Y"
