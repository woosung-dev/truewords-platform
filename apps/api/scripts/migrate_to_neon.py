"""Neon으로 운영 데이터 이관.

단계:
  1) Neon public 스키마 DROP → CREATE (초기화)
  2) 로컬 Alembic 마이그레이션을 Neon에 적용 (스키마 생성)
  3) 로컬에서 정의 테이블만 Neon으로 복사
     - admin_users, chatbot_configs, data_source_categories
     - alembic_version (스키마 적용 후 자동)
  4) 히스토리 테이블은 비운 상태로 남김
     (answer_citations, answer_feedback, admin_audit_logs, ingestion_jobs,
      batch_jobs, search_events, research_sessions, session_messages)

사용:
  uv run python scripts/migrate_to_neon.py --dry-run
  uv run python scripts/migrate_to_neon.py --execute
"""
import argparse
import asyncio
import os
import subprocess
import sys
from pathlib import Path

import asyncpg

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

COPY_TABLES = ["admin_users", "chatbot_configs", "data_source_categories"]
SKIP_TABLES = [
    "answer_citations", "answer_feedback", "admin_audit_logs",
    "ingestion_jobs", "batch_jobs", "search_events",
    "research_sessions", "session_messages",
]


def asyncpg_url(url: str) -> str:
    # asyncpg는 postgresql+asyncpg 스킴이나 SQLAlchemy 파라미터를 싫어함
    return url.replace("postgresql+asyncpg://", "postgresql://")


async def count_rows(conn: asyncpg.Connection, table: str) -> int:
    try:
        return await conn.fetchval(f'SELECT COUNT(*) FROM "{table}"')
    except Exception:
        return -1


async def preview():
    local_url = asyncpg_url(os.environ["DATABASE_URL"])
    neon_url = os.environ["NEON_DATABASE_URL"]

    print("=" * 70)
    print("DRY RUN — 이관 대상 미리보기")
    print("=" * 70)

    local = await asyncpg.connect(local_url)
    neon = await asyncpg.connect(neon_url)

    print("\n[로컬 DB 현황]")
    for t in COPY_TABLES + SKIP_TABLES:
        print(f"  {t:30s} rows={await count_rows(local, t)}")

    print("\n[Neon 현황 (이관 전)]")
    neon_tables = await neon.fetch(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
    )
    for row in neon_tables:
        t = row["table_name"]
        print(f"  {t:30s} rows={await count_rows(neon, t)}")

    print("\n[계획]")
    print(f"  1) Neon.public 스키마 DROP+CREATE (기존 {len(neon_tables)}개 테이블 전부 삭제)")
    print(f"  2) alembic upgrade head (Neon에 새 스키마 생성)")
    print(f"  3) 데이터 복사: {COPY_TABLES}")
    print(f"  4) 비워 둘 히스토리: {SKIP_TABLES}")

    await local.close()
    await neon.close()


async def copy_table(src: asyncpg.Connection, dst: asyncpg.Connection, table: str) -> int:
    rows = await src.fetch(f'SELECT * FROM "{table}"')
    # 타겟 테이블 비우기 (alembic 마이그레이션이 시드를 넣었을 가능성)
    await dst.execute(f'TRUNCATE TABLE "{table}" RESTART IDENTITY CASCADE')
    if not rows:
        print(f"    {table}: 빈 테이블, 스킵")
        return 0
    cols = list(rows[0].keys())
    col_list = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
    insert_sql = f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders})'
    async with dst.transaction():
        for r in rows:
            await dst.execute(insert_sql, *[r[c] for c in cols])
    return len(rows)


async def execute():
    local_url = asyncpg_url(os.environ["DATABASE_URL"])
    neon_url = os.environ["NEON_DATABASE_URL"]

    print("=" * 70)
    print("EXECUTE — 실제 이관 시작")
    print("=" * 70)

    # 1. Neon 스키마 초기화
    print("\n[1/4] Neon.public 스키마 DROP + CREATE")
    neon = await asyncpg.connect(neon_url)
    await neon.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    # 권한 복원 (Neon default)
    await neon.execute("GRANT ALL ON SCHEMA public TO neondb_owner;")
    await neon.execute("GRANT ALL ON SCHEMA public TO public;")
    await neon.close()
    print("    ✅ 초기화 완료")

    # 2. Alembic upgrade on Neon
    print("\n[2/4] Alembic upgrade head (Neon)")
    # Settings(extra='forbid')가 NEON_*/QCLOUD_* 변수 거부하므로 제거
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("NEON_", "QCLOUD_"))}
    # asyncpg는 sslmode 대신 ssl 파라미터 사용
    neon_asyncpg = neon_url.replace("postgresql://", "postgresql+asyncpg://").replace("sslmode=", "ssl=")
    env["DATABASE_URL"] = neon_asyncpg
    res = subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        print("    ❌ Alembic 실패:")
        print(res.stderr)
        sys.exit(1)
    print("    ✅ 스키마 생성 완료")

    # 3. 데이터 복사
    print("\n[3/4] 정의 테이블 복사")
    local = await asyncpg.connect(local_url)
    neon = await asyncpg.connect(neon_url)
    for t in COPY_TABLES:
        n = await copy_table(local, neon, t)
        print(f"    ✅ {t}: {n} rows")
    await local.close()

    # 4. 검증
    print("\n[4/4] Neon 검증")
    for t in COPY_TABLES + SKIP_TABLES:
        print(f"    {t:30s} rows={await count_rows(neon, t)}")
    await neon.close()

    print("\n🎉 Neon 이관 완료")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    # .env 로드
    env_file = BACKEND_DIR / ".env"
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k, v)

    if args.execute:
        await execute()
    else:
        await preview()


if __name__ == "__main__":
    asyncio.run(main())
