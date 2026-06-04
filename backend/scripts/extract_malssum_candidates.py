# 레드팀 시연 — 기존 Qdrant 컬렉션에서 짧은 말씀 후보를 카테고리별로 추출 (큐레이션 1단계)
"""featured_malssum.json 을 채우기 위한 후보 추출 스크립트.

기존 운영 컬렉션(malssum_poc_v5)을 raw httpx scroll 로 훑어, 카테고리(source)별로
지정 길이 범위의 짧은 본문을 모아 후보 JSON 으로 저장한다. 사람이 이 후보를
검토해 원하는 항목만 남겨 `src/malssum/featured_malssum.json` 으로 옮기면 된다.

의미 검색이 아니라 무작위 노출용 목록이므로 임베딩/별도 컬렉션은 사용하지 않는다.

실행 예:
    uv run python scripts/extract_malssum_candidates.py \
        --categories O,B,M --per-category 30 \
        --out scripts/featured_malssum.candidates.json

카테고리 키: L 원리강론 / M 3대경전 / N 자서전 / O 말씀선집 / B 어머니말씀 /
            P 참부모론 / Q 통일사상요강 (src/pipeline/metadata.py 기준)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
from pathlib import Path

import httpx

from src.config import settings


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if settings.qdrant_api_key:
        h["api-key"] = settings.qdrant_api_key.get_secret_value()
    return h


async def _scroll_category(
    client: httpx.AsyncClient,
    base: str,
    collection: str,
    category: str,
    *,
    min_len: int,
    max_len: int,
    scan_limit: int,
) -> list[dict]:
    """단일 카테고리(source)를 scroll 하며 길이 범위 본문을 수집."""
    collected: list[dict] = []
    offset = None
    scanned = 0
    while scanned < scan_limit:
        body: dict = {
            "limit": 256,
            "with_payload": True,
            "with_vector": False,
            "filter": {"must": [{"key": "source", "match": {"any": [category]}}]},
        }
        if offset is not None:
            body["offset"] = offset
        resp = await client.post(
            f"{base}/collections/{collection}/points/scroll",
            headers=_headers(),
            json=body,
        )
        resp.raise_for_status()
        result = resp.json().get("result", {})
        points = result.get("points", [])
        if not points:
            break
        for p in points:
            payload = p.get("payload", {})
            text = str(payload.get("text", "")).strip()
            if min_len <= len(text) <= max_len:
                collected.append(
                    {
                        "text": text,
                        "category": category,
                        "volume": str(payload.get("volume", "")),
                    }
                )
        scanned += len(points)
        offset = result.get("next_page_offset")
        if offset is None:
            break
    return collected


async def main() -> None:
    parser = argparse.ArgumentParser(description="짧은 말씀 후보 추출 (레드팀 시연)")
    parser.add_argument(
        "--categories",
        default="O,B,M",
        help="추출할 source 카테고리 키 (쉼표 구분). 예: O,B,M",
    )
    parser.add_argument("--per-category", type=int, default=30, help="카테고리당 후보 수")
    parser.add_argument("--min-len", type=int, default=50, help="본문 최소 글자 수")
    parser.add_argument("--max-len", type=int, default=300, help="본문 최대 글자 수")
    parser.add_argument(
        "--scan-limit",
        type=int,
        default=20000,
        help="카테고리당 최대 scroll 포인트 수 (성능 가드)",
    )
    parser.add_argument(
        "--out",
        default="scripts/featured_malssum.candidates.json",
        help="후보 JSON 저장 경로",
    )
    args = parser.parse_args()

    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    base = settings.qdrant_url.rstrip("/")
    collection = settings.collection_name

    print(f"컬렉션: {collection} @ {base}")
    print(f"카테고리: {categories} / 길이 {args.min_len}~{args.max_len}자")

    out: list[dict] = []
    async with httpx.AsyncClient(http2=False, timeout=60.0) as client:
        for cat in categories:
            pool = await _scroll_category(
                client,
                base,
                collection,
                cat,
                min_len=args.min_len,
                max_len=args.max_len,
                scan_limit=args.scan_limit,
            )
            # 다양성을 위해 풀에서 무작위 표본 추출 (풀이 작으면 전체).
            picked = (
                random.sample(pool, args.per_category)
                if len(pool) > args.per_category
                else pool
            )
            out.extend(picked)
            print(f"  [{cat}] 풀 {len(pool)}개 → 후보 {len(picked)}개")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"\n총 {len(out)}개 후보 저장 → {out_path}")
    print("검토 후 원하는 항목만 남겨 src/malssum/featured_malssum.json 으로 옮기세요.")


if __name__ == "__main__":
    asyncio.run(main())
