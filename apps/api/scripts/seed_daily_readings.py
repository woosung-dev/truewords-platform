"""훈독 오늘 말씀 시드 — 로컬·E2E 전용 (PLAN-HD-001 결정 6).

featured_malssum.json 20건을 KST 오늘부터 N일분 daily_readings 로 넣는다. 권리 미확정
발췌이므로 authority_grade="R"(권리 확인 중)·review_status="unverified" 로 두고
source_note 에 시드 출처를 남긴다. **운영 DB 에는 실행하지 않는다** — 편성은 운영자
수기 입력(결정 5)이며 이 데이터는 편성 데이터로 승격하지 않는다.

사용: uv run python scripts/seed_daily_readings.py [--days 20] [--start YYYY-MM-DD]
이미 있는 날짜는 건너뛴다(멱등).
"""

import argparse
import asyncio
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import select

from app.core.common.clock import today_kst
from app.core.common.database import async_session_factory, init_db
from app.core.config import settings
from app.modules.hoondok.models import DailyReading

MALSSUM_PATH = Path(__file__).resolve().parent.parent / "app/modules/malssum/featured_malssum.json"
SOURCE_NOTE = "featured_malssum.json 시드 (로컬·E2E 전용, 운영 편성 승격 금지)"


def _title_of(text: str) -> str:
    """첫 문장을 제목으로. 60자 넘으면 자른다."""
    first = text.split(". ")[0].strip().rstrip(".")
    return first if len(first) <= 60 else f"{first[:59]}…"


def _speaker_of(source: str) -> str:
    if "어머님" in source:
        return "참어머님"
    if "아버님" in source:
        return "참아버님"
    return source


def build_readings(items: list[dict], start: date, days: int) -> list[DailyReading]:
    readings: list[DailyReading] = []
    for offset in range(min(days, len(items))):
        item = items[offset]
        readings.append(
            DailyReading(
                reading_date=start + timedelta(days=offset),
                title=_title_of(item["text"]),
                body=item["text"],
                speaker=_speaker_of(item.get("source", "")),
                spoken_on=None,
                work_title=item.get("volume", ""),
                edition=None,
                authority_grade="R",
                review_status="unverified",
                source_note=SOURCE_NOTE,
                estimated_minutes=3,
            )
        )
    return readings


async def seed(start: date, days: int) -> None:
    if settings.environment == "production":
        raise SystemExit("운영 환경에서는 시드를 실행하지 않는다 (PLAN-HD-001 결정 6)")
    items = json.loads(MALSSUM_PATH.read_text(encoding="utf-8"))
    await init_db()
    async with async_session_factory() as session:
        for reading in build_readings(items, start, days):
            existing = await session.execute(
                select(DailyReading).where(DailyReading.reading_date == reading.reading_date)
            )
            if existing.scalar_one_or_none():
                print(f"  이미 존재: {reading.reading_date}")
                continue
            session.add(reading)
            print(f"  추가: {reading.reading_date} {reading.title}")
        await session.commit()
    print("daily_readings 시드 완료")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=20)
    parser.add_argument("--start", type=date.fromisoformat, default=None)
    args = parser.parse_args()
    asyncio.run(seed(args.start or today_kst(), args.days))
