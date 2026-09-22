"""Qdrant volume 목록 → `content_rights` 권리 원장 시드 (PLAN-HD-007 §2-1·3·4).

흐름:
  Qdrant `volume` facet(안 되면 scroll) → 6시리즈 분류 → `content_rights` upsert
    → `--allow` 로 지정한 시리즈만 `allowed + scope_search + scope_full_text + 등급`

등록 범위는 `library_series.BOOK_SERIES_TITLES` 6시리즈다. 참어머님 말씀·기타 파일은
건너뛰고 stdout 에 목록만 낸다(계획 §2-3, 후속 과제).

이미 있는 행의 `status`·`scope_*`·`authority_grade`·`note` 는 건드리지 않는다 —
운영자가 admin 에서 정한 값이 스크립트 재실행으로 되돌아가면 안 된다. 다만 `--allow`
로 명시한 시리즈는 운영자 의도가 명시된 것으로 보고 기존 행에도 적용한다.

종료 코드:
  0  성공
  1  Qdrant 연결 실패 · 잘못된 `--allow` 값

사용:
  uv run python scripts/seed_content_rights_from_qdrant.py --dry-run
  uv run python scripts/seed_content_rights_from_qdrant.py --execute \
      --allow "천성경,평화경,원리강론" --grade O1
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import unicodedata
from pathlib import Path

# scripts/ 에서 app/* import 가능하도록 apps/api/ 를 sys.path 에 추가
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlmodel import select  # noqa: E402

from app.core.common.database import async_session_factory  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.modules.hoondok.library_series import BOOK_SERIES_TITLES, series_title  # noqa: E402
from app.modules.hoondok.models import ContentRight, _utcnow  # noqa: E402
from app.modules.pipeline.metadata import classify_book_series  # noqa: E402
from app.modules.qdrant.raw_client import RawQdrantClient  # noqa: E402

# facet 은 운영 Qdrant 에만 있다(구버전은 404). scroll 로 떨어질 때의 페이지 크기.
_SCROLL_LIMIT = 10000
_FACET_LIMIT = 4096

# `classify_book_series` 는 자서전을 "참부모님 자서전" 파일명으로만 잡는다.
# 운영 컬렉션의 실제 파일명은 `평화를 사랑하는 세계인으로.txt` 라 여기서 보완한다.
_EXTRA_SERIES_RULES: list[tuple[str, str]] = [
    ("평화를 사랑하는 세계인으로", "chambumo_autobiography"),
]


def classify_volume_series(volume: str) -> str:
    """volume 파일명 → 시리즈 키. 등록 범위 밖이면 빈 문자열."""
    series = classify_book_series(Path(volume))
    if not series:
        normalized = unicodedata.normalize("NFC", volume)
        for keyword, key in _EXTRA_SERIES_RULES:
            if unicodedata.normalize("NFC", keyword) in normalized:
                series = key
                break
    return series if series in BOOK_SERIES_TITLES else ""


async def list_volume_counts(client: RawQdrantClient, collection: str) -> dict[str, int]:
    """volume → 청크 수. facet 을 먼저 쓰고 실패하면 scroll 로 전수 집계한다."""
    try:
        hits = await client.facet(collection, key="volume", limit=_FACET_LIMIT, exact=True)
        if hits:
            return {str(hit.value): int(hit.count) for hit in hits if hit.value}
    except Exception as error:  # 구버전 Qdrant 는 /facet 404
        print(f"[info] facet 사용 불가 ({error}) — scroll 로 전수 집계한다", flush=True)

    counts: dict[str, int] = {}
    offset: str | int | None = None
    while True:
        points, offset = await client.scroll(
            collection, with_payload=["volume"], limit=_SCROLL_LIMIT, offset=offset
        )
        for point in points:
            volume = str((point.payload or {}).get("volume") or "")
            if volume:
                counts[volume] = counts.get(volume, 0) + 1
        if offset is None:
            return counts


def resolve_allow(raw: str) -> set[str]:
    """`--allow` 의 쉼표 목록(시리즈 키 또는 한글 제목) → 키 집합. 모르는 값이면 ValueError."""
    by_title = {title: key for key, title in BOOK_SERIES_TITLES.items()}
    keys: set[str] = set()
    for token in (part.strip() for part in raw.split(",")):
        if not token:
            continue
        if token in BOOK_SERIES_TITLES:
            keys.add(token)
        elif token in by_title:
            keys.add(by_title[token])
        else:
            raise ValueError(f"알 수 없는 시리즈: {token}")
    return keys


def _apply_allow(right: ContentRight, grade: str) -> None:
    right.status = "allowed"
    right.scope_search = True
    right.scope_full_text = True
    right.authority_grade = grade


def _build_new(volume: str, series: str, chunk_count: int) -> ContentRight:
    return ContentRight(
        volume=volume,
        status="pending",
        scope_search=False,
        scope_full_text=False,
        scope_jeongseong=False,
        work_title=series_title(series),
        source_keys=[],
        book_series=series,
        authority_grade="R",
        chunk_count=chunk_count,
    )


async def seed(counts: dict[str, int], allow: set[str], grade: str, execute: bool) -> None:
    """분류 결과를 원장에 반영하고 계획을 stdout 에 낸다. `execute=False` 면 쓰지 않는다."""
    grouped: dict[str, list[tuple[str, int]]] = {}
    skipped: list[str] = []
    for volume, count in sorted(counts.items()):
        series = classify_volume_series(volume)
        if not series:
            skipped.append(volume)
            continue
        grouped.setdefault(series, []).append((volume, count))

    async with async_session_factory() as session:
        result = await session.execute(select(ContentRight))
        existing = {right.volume: right for right in result.scalars().all()}

        created = updated = 0
        print(f"{'시리즈':28} {'권':>5} {'신규':>5} {'기존':>5} {'허용':>5}")
        for series in BOOK_SERIES_TITLES:
            volumes = grouped.get(series, [])
            if not volumes:
                continue
            is_allowed = series in allow
            new_rows = 0
            for volume, count in volumes:
                right = existing.get(volume)
                if right is None:
                    right = _build_new(volume, series, count)
                    if is_allowed:
                        _apply_allow(right, grade)
                    new_rows += 1
                    created += 1
                    session.add(right)
                    continue
                # 기존 행은 분류·청크 수만 보정한다(계획 §3 "스크립트 2").
                right.book_series = series
                right.chunk_count = count
                if not right.work_title:
                    right.work_title = series_title(series)
                if is_allowed:
                    _apply_allow(right, grade)
                right.updated_at = _utcnow()
                updated += 1
            label = f"{series_title(series)}({series})"
            print(
                f"{label[:28]:28} {len(volumes):5} {new_rows:5} "
                f"{len(volumes) - new_rows:5} {'예' if is_allowed else '-':>5}"
            )

        if execute:
            await session.commit()
            print(f"\n반영 완료 — 신규 {created} · 갱신 {updated}")
        else:
            await session.rollback()
            print(f"\n[dry-run] 쓰지 않음 — 신규 예정 {created} · 갱신 예정 {updated}")

    print(f"\n등록 대상 밖 {len(skipped)} 건 (계획 §2-3 후속):")
    for volume in skipped:
        print(f"  - {volume}")


async def _main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="계획만 출력 (기본값)")
    mode.add_argument("--execute", action="store_true", help="실제 반영")
    parser.add_argument(
        "--allow",
        default="",
        help='즉시 허용할 시리즈 쉼표 목록 (예: "천성경,평화경,원리강론")',
    )
    parser.add_argument("--grade", default="O1", help="--allow 시리즈에 줄 권위 등급 (기본 O1)")
    args = parser.parse_args()

    if settings.environment == "production" and not args.execute:
        print("운영 환경에서는 --execute 로만 실행한다", file=sys.stderr)
        return 1

    try:
        allow = resolve_allow(args.allow)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    client = RawQdrantClient()
    try:
        counts = await list_volume_counts(client, settings.collection_name)
    except Exception as error:
        print(f"Qdrant 연결 실패: {error}", file=sys.stderr)
        return 1
    if not counts:
        print("Qdrant 에서 volume 을 찾지 못했다", file=sys.stderr)
        return 1

    await seed(counts, allow, args.grade, execute=args.execute)
    return 0


def main() -> int:
    return asyncio.run(_main())


if __name__ == "__main__":
    sys.exit(main())
