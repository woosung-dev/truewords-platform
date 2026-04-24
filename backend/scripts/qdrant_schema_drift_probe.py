"""운영 ↔ staging Qdrant 컬렉션의 payload index 스키마 drift 사전 탐지.

실행 전제: staging 프로비저닝 완료 후 `QDRANT_URL`, `QDRANT_API_KEY` 설정.
사용:
    uv run python scripts/qdrant_schema_drift_probe.py --dry-run
    uv run python scripts/qdrant_schema_drift_probe.py --execute --report reports/drift.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import PayloadSchemaType

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

SchemaDict = dict[str, PayloadSchemaType]

# 운영 기대 스키마 — src/qdrant_client.create_payload_indexes 와 동기화
EXPECTED_MAIN_SCHEMA: SchemaDict = {
    "source": PayloadSchemaType.KEYWORD,
    "volume": PayloadSchemaType.KEYWORD,
}

EXPECTED_CACHE_SCHEMA: SchemaDict = {
    "chatbot_id": PayloadSchemaType.KEYWORD,
}


def load_expected_schema(kind: Literal["main", "cache"]) -> SchemaDict:
    if kind == "main":
        return dict(EXPECTED_MAIN_SCHEMA)
    if kind == "cache":
        return dict(EXPECTED_CACHE_SCHEMA)
    raise ValueError(f"unknown kind: {kind}")


@dataclass(frozen=True)
class DriftReport:
    collection: str
    missing_in_target: list[str] = field(default_factory=list)
    extra_in_target: list[str] = field(default_factory=list)
    type_mismatch: list[tuple[str, str, str]] = field(default_factory=list)

    @property
    def is_drift(self) -> bool:
        return bool(self.missing_in_target or self.extra_in_target or self.type_mismatch)


def compare_schemas(
    collection: str,
    expected: SchemaDict,
    actual: SchemaDict,
) -> DriftReport:
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    mismatch = sorted(
        (k, expected[k].value, actual[k].value)
        for k in (set(expected) & set(actual))
        if expected[k] != actual[k]
    )
    return DriftReport(
        collection=collection,
        missing_in_target=missing,
        extra_in_target=extra,
        type_mismatch=mismatch,
    )


async def fetch_actual_schema(
    client: AsyncQdrantClient, collection_name: str
) -> SchemaDict:
    """qdrant-client 1.17 payload_schema (dict[str, PayloadIndexInfo]) → SchemaDict."""
    info = await client.get_collection(collection_name)
    return {name: idx.data_type for name, idx in info.payload_schema.items()}


async def probe(
    *,
    qdrant_url: str,
    api_key: str | None,
    main_collection: str,
    cache_collection: str,
) -> list[DriftReport]:
    client = AsyncQdrantClient(url=qdrant_url, api_key=api_key)
    try:
        reports: list[DriftReport] = []
        targets: tuple[tuple[Literal["main", "cache"], str], ...] = (
            ("main", main_collection),
            ("cache", cache_collection),
        )
        for kind, name in targets:
            actual = await fetch_actual_schema(client, name)
            reports.append(compare_schemas(name, load_expected_schema(kind), actual))
        return reports
    finally:
        await client.close()


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="stdout 리포트만")
    mode.add_argument("--execute", action="store_true", help="리포트 JSON 파일 출력")
    parser.add_argument("--report", type=Path, default=Path("reports/qdrant_drift.json"))
    parser.add_argument("--main", default="malssum_poc_staging")
    parser.add_argument("--cache", default="semantic_cache_staging")
    return parser.parse_args(argv)


def _load_env() -> tuple[str, str | None]:
    import os

    url = os.environ.get("QDRANT_URL")
    if not url:
        raise RuntimeError("QDRANT_URL 환경변수가 필요합니다.")
    return url, os.environ.get("QDRANT_API_KEY")


async def _async_main(args: argparse.Namespace) -> int:
    url, api_key = _load_env()
    reports = await probe(
        qdrant_url=url,
        api_key=api_key,
        main_collection=args.main,
        cache_collection=args.cache,
    )
    payload = [
        {
            "collection": r.collection,
            "missing_in_target": r.missing_in_target,
            "extra_in_target": r.extra_in_target,
            "type_mismatch": r.type_mismatch,
            "is_drift": r.is_drift,
        }
        for r in reports
    ]
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.execute:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text, encoding="utf-8")
    print(text)
    return 1 if any(r.is_drift for r in reports) else 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_async_main(_parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
