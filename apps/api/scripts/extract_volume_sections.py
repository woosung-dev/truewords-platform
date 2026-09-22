"""Qdrant 본문 → `volume_sections` 장 목차 추출 (PLAN-HD-007 §2-2 · ENT-HD-010).

추출 규칙 자체는 `app/modules/hoondok/section_rules.py` (순수 함수) 에 있고 이 스크립트는
Qdrant 읽기 · 커버리지 보고 · DB 쓰기만 한다. LLM 은 쓰지 않는다.

대상 선택:
  --volume "천성경.pdf"   한 권만 (DB 없이도 --dry-run 가능)
  --series cheonseong_gyeong   Qdrant 분류 기준 시리즈 전체 (DB 없이도 --dry-run 가능)
  (기본)                  `content_rights` 에 등록된 6시리즈 전 권

쓰기는 `LibraryRepository.replace_auto_sections` 로만 한다 — `origin='auto'` 행만 교체하고
운영자 수기(`manual`) 행은 보존한다. 장이 0건인 권은 stale auto 행만 지우고 아무것도 넣지
않는다(프런트가 "구간 N" 으로 폴백).

종료 코드:
  0  성공
  1  Qdrant 연결 실패 · 대상 0건

사용:
  uv run python scripts/extract_volume_sections.py --dry-run --series cheonseong_gyeong
  uv run python scripts/extract_volume_sections.py --execute
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from sqlmodel import select  # noqa: E402

from app.core.common.database import async_session_factory  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.modules.hoondok.library_repository import LibraryRepository  # noqa: E402
from app.modules.hoondok.library_series import BOOK_SERIES_TITLES  # noqa: E402
from app.modules.hoondok.models import ContentRight, VolumeSection  # noqa: E402
from app.modules.hoondok.section_rules import extract_sections  # noqa: E402
from app.modules.qdrant.filters import build_filter, field_match  # noqa: E402
from app.modules.qdrant.raw_client import RawQdrantClient  # noqa: E402
from seed_content_rights_from_qdrant import (  # noqa: E402
    classify_volume_series,
    list_volume_counts,
)

_SCROLL_LIMIT = 10000


async def load_chunks(
    client: RawQdrantClient, collection: str, volume: str
) -> list[tuple[int, str]]:
    """한 권의 (chunk_index, text) 전량. chunk_index 오름차순."""
    chunks: list[tuple[int, str]] = []
    offset: str | int | None = None
    scroll_filter = build_filter(must=[field_match("volume", volume)])
    while True:
        points, offset = await client.scroll(
            collection,
            scroll_filter=scroll_filter,
            with_payload=["text", "chunk_index"],
            limit=_SCROLL_LIMIT,
            offset=offset,
        )
        for point in points:
            payload = point.payload or {}
            index = payload.get("chunk_index")
            if index is None:
                continue
            chunks.append((int(index), str(payload.get("text") or "")))
        if offset is None:
            break
    chunks.sort(key=lambda item: item[0])
    return chunks


async def select_targets(
    client: RawQdrantClient, volume: str | None, series: str | None
) -> list[tuple[str, str]]:
    """(volume, series) 목록. --volume·--series 는 Qdrant 분류만 쓰고 DB 를 읽지 않는다."""
    if volume is not None:
        matched = classify_volume_series(volume)
        return [(volume, matched)] if matched else []
    if series is not None:
        counts = await list_volume_counts(client, settings.collection_name)
        return sorted(
            (name, series) for name in counts if classify_volume_series(name) == series
        )
    async with async_session_factory() as session:
        result = await session.execute(
            select(ContentRight).where(ContentRight.book_series.in_(list(BOOK_SERIES_TITLES)))
        )
        rows = result.scalars().all()
    return sorted((row.volume, str(row.book_series)) for row in rows)


def _to_rows(volume: str, sections: list[dict]) -> list[VolumeSection]:
    return [
        VolumeSection(
            volume=volume,
            position=int(section["position"]),
            level=int(section["level"]),
            title=str(section["title"]),
            start_chunk_index=int(section["start_chunk_index"]),
            end_chunk_index=int(section["end_chunk_index"]),
            spoken_on=section["spoken_on"],
            place=section["place"],
            origin="auto",
        )
        for section in sections
    ]


async def run(targets: list[tuple[str, str]], execute: bool) -> None:
    client = RawQdrantClient()
    empty: list[str] = []
    totals: dict[str, list[int]] = {}  # series → [권, L1, L2, 0건 권]

    for volume, series in targets:
        chunks = await load_chunks(client, settings.collection_name, volume)
        sections = extract_sections(series, chunks)
        level1 = sum(1 for item in sections if item["level"] == 1)
        level2 = len(sections) - level1
        stats = totals.setdefault(series, [0, 0, 0, 0])
        stats[0] += 1
        stats[1] += level1
        stats[2] += level2
        titles = [str(item["title"])[:24] for item in sections[:3]]
        if not sections:
            empty.append(volume)
            stats[3] += 1
        print(f"{volume[:34]:36} L1={level1:4} L2={level2:5} {titles}")

        if execute:
            async with async_session_factory() as session:
                await LibraryRepository(session).replace_auto_sections(
                    volume, _to_rows(volume, sections)
                )

    print(f"\n{'시리즈':24} {'권':>5} {'L1':>6} {'L2':>6} {'0건':>5}")
    for series, (volumes, level1, level2, zeros) in totals.items():
        print(f"{series:24} {volumes:5} {level1:6} {level2:6} {zeros:5}")
    if empty:
        print(f"\n장 0건 {len(empty)} 권 (프런트 '구간 N' 폴백):")
        for volume in empty:
            print(f"  - {volume}")
    print("\n반영 완료" if execute else "\n[dry-run] 쓰지 않음")


async def _main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="커버리지 보고만 (기본값)")
    mode.add_argument("--execute", action="store_true", help="volume_sections 반영")
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--volume", default=None, help="Qdrant payload 의 volume 문자열 1건")
    scope.add_argument("--series", default=None, choices=sorted(BOOK_SERIES_TITLES))
    args = parser.parse_args()

    if settings.environment == "production" and not args.execute:
        print("운영 환경에서는 --execute 로만 실행한다", file=sys.stderr)
        return 1

    client = RawQdrantClient()
    try:
        targets = await select_targets(client, args.volume, args.series)
    except Exception as error:
        print(f"대상 조회 실패: {error}", file=sys.stderr)
        return 1
    if not targets:
        print("대상 권이 없다 (등록된 시리즈인지 확인)", file=sys.stderr)
        return 1

    await run(targets, execute=args.execute)
    return 0


def main() -> int:
    return asyncio.run(_main())


if __name__ == "__main__":
    sys.exit(main())
