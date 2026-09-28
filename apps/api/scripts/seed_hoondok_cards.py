"""오늘의 책갈피 카드 풀 시드 — 로컬·E2E 전용 (PLAN-HD-012, ENT-HD-019).

흐름:
  엑셀 `말씀카드_후보문구.xlsx` 의 11탭(말씀선집 제외, `01_`~`11_`) 문구
    → Qdrant(raw httpx) 에서 말씀선집이 아닌 권의 청크 text 를 읽어
    → 한글만 남기는 정규화 후 포함 검사로 원문 청크를 찾고
    → chunk_id(point id)·chunk_index 를 붙여 `word_cards` 에 **draft** 로 넣는다.

일치하는 청크가 없는 문구는 건너뛰고 요약에 센다. 같은 문구+청크가 이미 있으면 건너뛴다(멱등).
`--execute` 가 없으면 dry-run 이다(DB 를 열지 않는다). 운영 환경에서는 실행하지 않는다 —
운영 카드 투입과 active 전환은 운영자가 admin(API-HD-052)에서 한다.

사용:
  uv run python scripts/seed_hoondok_cards.py                 # dry-run
  uv run python scripts/seed_hoondok_cards.py --execute
  uv run python scripts/seed_hoondok_cards.py --xlsx 경로 --qdrant-url http://localhost:6333 --collection malssum_poc_v5
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlmodel import select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.modules.hoondok.models import WordCard  # noqa: E402
from app.modules.qdrant.raw_client import RawQdrantClient  # noqa: E402

DEFAULT_XLSX = Path.home() / "Downloads/말씀카드/말씀카드_후보문구.xlsx"
DEFAULT_QDRANT_URL = "http://localhost:6333"
DEFAULT_COLLECTION = "malssum_poc_v5"
EXCLUDED_VOLUME_KEYWORD = "말씀선집"  # 엑셀 범위 밖(말씀선집 제외)
TAB_PATTERN = re.compile(r"^(\d{2})_(.+)$")  # "01_천성경" — 요약·천심원 카드 탭은 제외
SCROLL_LIMIT = 1000

# 탭 번호 → 우선 대조할 volume 키워드. 없는 탭(참어머님 말씀 등)은 말씀선집 밖 전 권을 본다.
PREFERRED_VOLUME = {
    "01": "천성경",
    "02": "평화경",
    "03": "원리강론",
    "04": "통일사상요강",
    "05": "평화를 사랑하는 세계인으로",
    "06": "평화의 어머니",
    "07": "참부모님의 위상과 가치",
    "08": "한민족 선민 대서사시",
}


def normalize(text: str) -> str:
    """한글 음절만 남긴다 — 띄어쓰기·문장부호·줄바꿈 교정 차이를 무시하고 포함 검사를 한다."""
    return re.sub(r"[^가-힣]", "", unicodedata.normalize("NFC", text or ""))


@dataclass(frozen=True)
class Phrase:
    tab: str  # "01"
    work_title: str  # 탭 이름에서 번호를 뗀 것 — 책장(API-HD-051) 묶음 이름
    text: str
    source_label: str
    topic: str | None
    chunk_hint: int | None  # 엑셀 "원본 chunk" — 여러 청크가 맞을 때 우선한다


@dataclass(frozen=True)
class Chunk:
    point_id: str
    volume: str
    chunk_index: int
    normalized: str


def read_phrases(path: Path) -> list[Phrase]:
    import openpyxl

    workbook = openpyxl.load_workbook(path, read_only=True)
    phrases: list[Phrase] = []
    for sheet in workbook.worksheets:
        match = TAB_PATTERN.match(sheet.title)
        if not match:
            continue
        rows = sheet.iter_rows(values_only=True)
        header = [str(h or "").strip() for h in next(rows)]
        col = {name: header.index(name) for name in ("말씀", "출처", "주제", "원본 chunk")}
        for row in rows:
            text = str(row[col["말씀"]] or "").strip()
            if not text:
                continue
            hint = str(row[col["원본 chunk"]] or "").strip()
            topic = str(row[col["주제"]] or "").strip() or None
            phrases.append(
                Phrase(
                    tab=match.group(1),
                    work_title=match.group(2).strip(),
                    text=text,
                    source_label=str(row[col["출처"]] or "").strip()[:300] or match.group(2),
                    topic=topic[:200] if topic else None,
                    chunk_hint=int(hint) if hint.isdigit() else None,
                )
            )
    return phrases


async def load_chunks(client: RawQdrantClient, collection: str) -> list[Chunk]:
    """말씀선집이 아닌 권의 청크 전부(약 1.7만). volume 목록은 facet 으로 먼저 구한다."""
    hits = await client.facet(collection, key="volume", limit=4096, exact=True)
    volumes = [str(h.value) for h in hits if h.value and EXCLUDED_VOLUME_KEYWORD not in str(h.value)]
    chunks: list[Chunk] = []
    offset: str | int | None = None
    scroll_filter = {"must": [{"key": "volume", "match": {"any": volumes}}]}
    while True:
        points, offset = await client.scroll(
            collection,
            scroll_filter=scroll_filter,
            with_payload=["volume", "chunk_index", "text"],
            limit=SCROLL_LIMIT,
            offset=offset,
        )
        for point in points:
            payload = point.payload or {}
            chunks.append(
                Chunk(
                    point_id=str(point.id),
                    volume=str(payload.get("volume") or ""),
                    chunk_index=int(payload.get("chunk_index") or 0),
                    normalized=normalize(str(payload.get("text") or "")),
                )
            )
        if offset is None:
            return chunks


def find_chunk(phrase: Phrase, chunks: list[Chunk]) -> Chunk | None:
    """정규화 포함 검사. 여러 청크가 맞으면 우선 권 → 엑셀 청크 번호 → volume·index 순으로 하나를 고른다."""
    needle = normalize(phrase.text)
    if not needle:
        return None
    preferred = PREFERRED_VOLUME.get(phrase.tab)
    matches = [c for c in chunks if needle in c.normalized]
    if not matches:
        return None
    return min(
        matches,
        key=lambda c: (
            not (preferred and preferred in c.volume),
            c.chunk_index != phrase.chunk_hint,
            c.volume,
            c.chunk_index,
        ),
    )


async def insert_cards(pairs: list[tuple[Phrase, Chunk]]) -> tuple[int, int]:
    from app.core.common.database import async_session_factory, init_db

    await init_db()
    created = skipped = 0
    async with async_session_factory() as session:
        existing = {(c.chunk_id, c.text) for c in (await session.execute(select(WordCard))).scalars()}
        for phrase, chunk in pairs:
            if (chunk.point_id, phrase.text) in existing:
                skipped += 1
                continue
            session.add(
                WordCard(
                    text=phrase.text,
                    volume=chunk.volume,
                    chunk_id=chunk.point_id,
                    chunk_index=chunk.chunk_index,
                    work_title=phrase.work_title,
                    source_label=phrase.source_label,
                    topic=phrase.topic,
                    status="draft",
                )
            )
            existing.add((chunk.point_id, phrase.text))
            created += 1
        await session.commit()
    return created, skipped


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--execute", action="store_true", help="실제로 word_cards 에 draft 로 넣는다(기본 dry-run)")
    parser.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX)
    parser.add_argument("--qdrant-url", default=DEFAULT_QDRANT_URL)
    parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    args = parser.parse_args()

    if args.execute and settings.environment == "production":
        raise SystemExit("운영 환경에서는 시드를 실행하지 않는다 — 운영 투입은 운영자가 admin 에서 한다")

    phrases = read_phrases(args.xlsx)
    chunks = await load_chunks(RawQdrantClient(base_url=args.qdrant_url, api_key=""), args.collection)
    pairs: list[tuple[Phrase, Chunk]] = []
    unmatched: dict[str, int] = {}
    for phrase in phrases:
        chunk = find_chunk(phrase, chunks)
        if chunk is None:
            unmatched[phrase.work_title] = unmatched.get(phrase.work_title, 0) + 1
            print(f"  [불일치] {phrase.work_title} · {phrase.text[:40]}")
        else:
            pairs.append((phrase, chunk))

    print(f"문구 {len(phrases)} · 청크 {len(chunks)} · 일치 {len(pairs)} · 불일치 {len(phrases) - len(pairs)}")
    for title, count in sorted(unmatched.items()):
        print(f"  불일치 {title}: {count}")
    if not args.execute:
        print("dry-run — 쓰지 않았다. --execute 로 draft 를 넣는다")
        return
    created, skipped = await insert_cards(pairs)
    print(f"draft 추가 {created} · 이미 있음 {skipped}")


if __name__ == "__main__":
    asyncio.run(main())
