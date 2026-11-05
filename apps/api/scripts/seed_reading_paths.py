"""7일 정성 정의·장 스냅샷 시드 (읽기 정성 1a, 계획 v2.1 §6).

정성 3개(천성경 7일 cs7 · 평화경 7일 ph7 · 천성경 21일 cs21) × 하루 분량 3/7/15분 장 스냅샷을 만든다.
권의 장 목차(volume_sections)와 Qdrant 청크를 읽어, 하루 분량에 닿을 때까지 청크를 차례로 묶는다.
분량은 글자 수 ÷ 분당 500자 [가정]. 장 제목은 그날 첫 청크가 들어 있는 목차 장이다.

- 권리(원문 보기 + 정성 이용)가 닫힌 권이면 실패한다 — 닫힌 장을 시드하지 않는다.
- 이미 있는 정성은 장이 같으면 그대로 두고, 다르면 version+1 로 새 장을 만든다(발행된 장은 고치지 않는다).
- `--publish` 가 없으면 새 정성은 draft 로 들어간다.

사용(apps/api):
  uv run python -m scripts.seed_reading_paths --publish
  uv run python -m scripts.seed_reading_paths --publish --volume 천성경=천성경.pdf   # 권 이름이 여럿일 때
  uv run python -m scripts.seed_reading_paths --publish --e2e                      # 격리 E2E fixture 권
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402
from sqlmodel import select  # noqa: E402

from app.core.common.clock import utcnow  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.modules.hoondok.display_text import PAGE_SIZE, to_display_text  # noqa: E402
from app.modules.hoondok.models import (  # noqa: E402
    PATH_MINUTES_TIERS,
    ContentRight,
    ReadingPath,
    ReadingPathStep,
    VolumeSection,
)
# reading_paths 의 users FK 를 풀려면 users 테이블이 메타데이터에 있어야 한다(없으면 flush 에서 NoReferencedTableError)
from app.modules.identity.models import User  # noqa: E402, F401
from app.modules.qdrant.filters import build_filter, field_match, field_range  # noqa: E402
from app.modules.search.hybrid import point_to_search_result  # noqa: E402

CHARS_PER_MINUTE = 500  # [가정] 어르신 소리 내어 읽기 기준 분당 글자 수
E2E_CHARS_PER_MINUTE = 6  # fixture 청크(약 120자)가 15분 단계에서도 하루 한 청크가 되게(21일 정성이 25청크 안에 든다)
E2E_VOLUME = "말씀선집 355권"  # seed_hoondok_journey.py 의 FIXTURE_VOLUME
FETCH_WINDOW = 400


@dataclass(frozen=True)
class PathDef:
    slug: str
    title: str
    book: str
    when_line: str
    duration_days: int
    sort_order: int
    continue_from: str | None = None  # 같은 권·분량에서 이 정성이 끝난 다음 청크부터 시작


PATH_DEFS: tuple[PathDef, ...] = (
    PathDef("cs7", "천성경 7일 정성", "천성경", "처음 시작할 때", 7, 1),
    PathDef("ph7", "평화경 7일 정성", "평화경", "평화경을 처음부터", 7, 2),
    # [가정] 21일 정성은 7일 정성 다음 장부터 이어 읽는다 — 마친 식구가 같은 장을 다시 읽지 않게.
    PathDef("cs21", "천성경 21일 정성", "천성경", "7일 정성을 마친 뒤", 21, 3, continue_from="cs7"),
)


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    chunk_index: int
    chars: int  # 원문 뷰 display_text 기준 글자 수


@dataclass(frozen=True)
class StepDraft:
    day_index: int
    start: Chunk
    end: Chunk
    title: str
    estimated_minutes: int


# 청크 창(lo 이상 hi 미만)을 chunk_index 순으로 돌려주는 함수
FetchChunks = Callable[[str, int, int], Awaitable[list[Chunk]]]


class SeedError(RuntimeError):
    """시드할 수 없는 상태(권리 닫힘·권 없음·청크 부족). 메시지를 그대로 보여 주고 실패한다."""


def section_title(sections: Sequence[VolumeSection], chunk_index: int, fallback: str) -> str:
    """청크가 들어 있는 가장 안쪽 목차 장. 같은 시작이면 level 이 큰(더 안쪽) 장."""
    inside = [s for s in sections if s.start_chunk_index <= chunk_index <= s.end_chunk_index]
    if not inside:
        return fallback
    return max(inside, key=lambda s: (s.start_chunk_index, s.level)).title


async def build_steps(
    fetch: FetchChunks,
    volume: str,
    start_index: int,
    duration_days: int,
    minutes_tier: int,
    sections: Sequence[VolumeSection],
    book: str,
    chars_per_minute: int = CHARS_PER_MINUTE,
) -> list[StepDraft]:
    """start_index 부터 하루 분량(minutes_tier × 분당 글자)에 닿을 때까지 청크를 묶어 duration_days 장을 만든다."""
    target = minutes_tier * chars_per_minute
    steps: list[StepDraft] = []
    buffer: list[Chunk] = []
    cursor = start_index
    day: list[Chunk] = []
    while len(steps) < duration_days:
        if not buffer:
            buffer = await fetch(volume, cursor, cursor + FETCH_WINDOW)
            if not buffer:
                raise SeedError(f"{volume}: {duration_days}일 {minutes_tier}분 정성에 필요한 청크가 모자라요")
            cursor = buffer[-1].chunk_index + 1
        chunk = buffer.pop(0)
        if day and chunk.chunk_index != day[-1].chunk_index + 1:
            raise SeedError(f"{volume}: chunk_index {day[-1].chunk_index + 1} 이 비어 있어요")
        day.append(chunk)
        chars = sum(c.chars for c in day)
        if chars >= target:
            steps.append(
                StepDraft(
                    day_index=len(steps) + 1,
                    start=day[0],
                    end=day[-1],
                    title=section_title(sections, day[0].chunk_index, f"{book} {len(steps) + 1}일째 말씀")[:200],
                    estimated_minutes=max(1, round(chars / chars_per_minute)),
                )
            )
            day = []
    return steps


def qdrant_fetcher(client) -> FetchChunks:
    """RawQdrantClient 로 청크 창을 읽는다. 원문 뷰와 같은 겹침 제거 규칙으로 글자 수를 센다."""

    async def fetch(volume: str, lo: int, hi: int) -> list[Chunk]:
        points, _ = await client.scroll(
            settings.collection_name,
            scroll_filter=build_filter(
                must=[field_match("volume", volume), field_range("chunk_index", gte=max(lo - 1, 0), lt=hi)]
            ),
            limit=hi - max(lo - 1, 0),
            with_vectors=False,
        )
        rows = sorted((point_to_search_result(p) for p in points), key=lambda r: r.chunk_index)
        texts = {r.chunk_index: r.text for r in rows}
        return [
            Chunk(
                chunk_id=r.chunk_id,
                chunk_index=r.chunk_index,
                chars=len(
                    to_display_text(texts.get(r.chunk_index - 1) if r.chunk_index % PAGE_SIZE else None, r.text)
                ),
            )
            for r in rows
            if r.chunk_index >= lo
        ]

    return fetch


def _is_open(right: ContentRight) -> bool:
    return right.status == "allowed" and right.scope_full_text and right.scope_jeongseong


async def resolve_volume(session: AsyncSession, book: str, override: str | None) -> str:
    """책 이름 → 권(volume). 권리(원문 보기 + 정성 이용)가 열린 권 하나여야 한다."""
    if override is not None:
        right = (await session.execute(select(ContentRight).where(ContentRight.volume == override))).scalar_one_or_none()
        if right is None or not _is_open(right):
            raise SeedError(f"{override}: 권리(원문 보기·정성 이용)가 닫혀 있어 시드할 수 없어요")
        return override
    rights = (await session.execute(select(ContentRight).where(ContentRight.volume.startswith(book)))).scalars().all()
    open_rights = [r for r in rights if _is_open(r)]
    if not open_rights:
        found = ", ".join(r.volume for r in rights) or "없음"
        raise SeedError(f"{book}: 권리(원문 보기·정성 이용)가 열린 권이 없어요 (찾은 권: {found})")
    if len(open_rights) > 1:
        names = ", ".join(r.volume for r in open_rights)
        raise SeedError(f"{book}: 권이 여럿이에요 ({names}). --volume {book}=<권> 으로 골라 주세요")
    return open_rights[0].volume


def _same(existing: Sequence[ReadingPathStep], drafts: dict[int, list[StepDraft]], volume: str) -> bool:
    current = sorted(
        (s.minutes_tier, s.day_index, s.volume, s.start_chunk_index, s.end_chunk_index, s.start_chunk_id, s.end_chunk_id, s.title)
        for s in existing
    )
    wanted = sorted(
        (tier, d.day_index, volume, d.start.chunk_index, d.end.chunk_index, d.start.chunk_id, d.end.chunk_id, d.title)
        for tier, rows in drafts.items()
        for d in rows
    )
    return current == wanted


async def seed_paths(
    session: AsyncSession,
    fetch: FetchChunks,
    *,
    publish: bool,
    volumes: dict[str, str] | None = None,
    chars_per_minute: int = CHARS_PER_MINUTE,
    defs: Sequence[PathDef] = PATH_DEFS,
    follow_continue: bool = True,
) -> list[str]:
    """정성 정의와 장을 넣고 커밋한다. 결과 한 줄 요약 목록을 돌려준다. 실패하면 아무것도 커밋하지 않는다."""
    volumes = volumes or {}
    summary: list[str] = []
    ends: dict[tuple[str, int], int] = {}  # (slug, tier) → 마지막 청크 다음 번호
    for definition in defs:
        volume = await resolve_volume(session, definition.book, volumes.get(definition.book))
        sections = (
            await session.execute(
                select(VolumeSection).where(VolumeSection.volume == volume).order_by(VolumeSection.position)
            )
        ).scalars().all()
        first = min((s.start_chunk_index for s in sections), default=0)
        drafts: dict[int, list[StepDraft]] = {}
        for tier in PATH_MINUTES_TIERS:
            start = first
            if follow_continue and definition.continue_from:
                start = ends.get((definition.continue_from, tier), first)
            rows = await build_steps(
                fetch, volume, start, definition.duration_days, tier, sections, definition.book, chars_per_minute
            )
            drafts[tier] = rows
            ends[(definition.slug, tier)] = rows[-1].end.chunk_index + 1

        path = (await session.execute(select(ReadingPath).where(ReadingPath.slug == definition.slug))).scalar_one_or_none()
        if path is None:
            path = ReadingPath(slug=definition.slug, version=1, status="draft")
            changed = True
        else:
            existing = (
                await session.execute(
                    select(ReadingPathStep).where(
                        ReadingPathStep.path_id == path.id, ReadingPathStep.path_version == path.version
                    )
                )
            ).scalars().all()
            changed = not _same(existing, drafts, volume)
            if changed and existing:
                path.version += 1  # 발행된 장은 고치지 않는다
        path.kind = "fixed"
        path.title = definition.title
        path.when_line = definition.when_line
        path.book = definition.book
        path.duration_days = definition.duration_days
        path.sort_order = definition.sort_order
        if publish and path.status != "published":
            path.status = "published"
            path.published_at = utcnow()
        session.add(path)
        await session.flush()
        if changed:
            for tier, rows in drafts.items():
                for d in rows:
                    session.add(
                        ReadingPathStep(
                            path_id=path.id,
                            path_version=path.version,
                            minutes_tier=tier,
                            day_index=d.day_index,
                            volume=volume,
                            start_chunk_index=d.start.chunk_index,
                            end_chunk_index=d.end.chunk_index,
                            start_chunk_id=d.start.chunk_id,
                            end_chunk_id=d.end.chunk_id,
                            title=d.title,
                            estimated_minutes=d.estimated_minutes,
                        )
                    )
        minutes = {tier: round(sum(d.estimated_minutes for d in rows) / len(rows)) for tier, rows in drafts.items()}
        summary.append(
            f"{definition.slug} v{path.version} {path.status} · {volume} · "
            f"{'새 장' if changed else '변경 없음'} · 하루 평균 {minutes}"
        )
    await session.commit()
    return summary


def _parse_volumes(values: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for value in values:
        book, sep, volume = value.partition("=")
        if not sep or not book or not volume:
            raise SystemExit(f"--volume 은 책=권 형식이에요: {value}")
        out[book] = volume
    return out


def _require_e2e_env() -> None:
    database_url = urlparse(settings.database_url.get_secret_value())
    if (
        settings.environment != "development"
        or database_url.hostname not in {"localhost", "127.0.0.1"}
        or database_url.port != 15432
        or database_url.path != "/truewords_e2e"
        or settings.qdrant_url != "http://127.0.0.1:16333"
    ):
        raise SystemExit("--e2e 는 격리 truewords_e2e DB·Qdrant에서만 실행할 수 있습니다")


async def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="7일 정성 정의·장 스냅샷 시드")
    parser.add_argument("--publish", action="store_true", help="정성을 발행 상태로 둔다")
    parser.add_argument("--volume", action="append", default=[], help="책=권 (예: 천성경=천성경.pdf)")
    parser.add_argument("--e2e", action="store_true", help="격리 E2E fixture 권(말씀선집 355권)으로 3개 정성을 만든다")
    args = parser.parse_args(argv)

    from app.core.common.database import async_session_factory
    from app.modules.qdrant import RawQdrantClient

    volumes = _parse_volumes(args.volume)
    chars_per_minute = CHARS_PER_MINUTE
    follow_continue = True
    if args.e2e:
        _require_e2e_env()
        volumes = {d.book: E2E_VOLUME for d in PATH_DEFS}
        chars_per_minute = E2E_CHARS_PER_MINUTE
        follow_continue = False  # fixture 권은 25청크뿐이라 21일 정성도 처음부터

    client = RawQdrantClient()
    async with async_session_factory() as session:
        try:
            summary = await seed_paths(
                session,
                qdrant_fetcher(client),
                publish=args.publish,
                volumes=volumes,
                chars_per_minute=chars_per_minute,
                follow_continue=follow_continue,
            )
        except SeedError as exc:
            await session.rollback()
            raise SystemExit(f"시드 실패: {exc}") from None
    for line in summary:
        print(line)


if __name__ == "__main__":
    asyncio.run(main())
