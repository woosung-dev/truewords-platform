"""Qdrant Cloud → 셀프 호스팅 VM Qdrant 풀 마이그레이션.

기존 `migrate_to_qdrant_cloud.py` 의 역방향 응용. 필터링 없이 모든 컬렉션·포인트
를 1:1 복제하며, 1GB 데이터에서 중단되어도 안전하게 재개할 수 있도록
체크포인트(`.migration_state.json`)를 사용한다.

환경변수 (backend/.env 또는 셸):
  QDRANT_CLOUD_URL       소스(Qdrant Cloud) URL
  QDRANT_CLOUD_API_KEY   소스 API key
  QDRANT_VM_URL          타겟(VM, Cloudflare Tunnel) URL — 예: https://qdrant.<zone>
  QDRANT_VM_API_KEY      타겟 API key

사용:
  uv run python scripts/migrate_cloud_to_vm.py --dry-run
  uv run python scripts/migrate_cloud_to_vm.py --execute
  uv run python scripts/migrate_cloud_to_vm.py --execute --collections malssum_poc
  uv run python scripts/migrate_cloud_to_vm.py --execute --reset   # 체크포인트 무시

체크포인트:
  backend/scripts/.migration_state.json (자동 생성)
  중단 후 같은 명령 재실행 시 자동 재개. --reset 로 초기화.
"""
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

from qdrant_client import AsyncQdrantClient, models

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

STATE_FILE = Path(__file__).resolve().parent / ".migration_state.json"
SCROLL_LIMIT = 500
UPSERT_BATCH = 100
DEFAULT_COLLECTIONS = ["malssum_poc", "semantic_cache"]


# ─────────────────────────── 체크포인트 유틸 ───────────────────────────
def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


# ─────────────────────────── 클라이언트 ───────────────────────────
def make_clients() -> tuple[AsyncQdrantClient, AsyncQdrantClient]:
    src = AsyncQdrantClient(
        url=os.environ["QDRANT_CLOUD_URL"],
        api_key=os.environ["QDRANT_CLOUD_API_KEY"],
        timeout=300,
    )
    tgt = AsyncQdrantClient(
        url=os.environ["QDRANT_VM_URL"],
        api_key=os.environ["QDRANT_VM_API_KEY"],
        timeout=300,
    )
    return src, tgt


async def collection_brief(client: AsyncQdrantClient, name: str) -> dict | None:
    try:
        info = await client.get_collection(name)
        return {
            "points": info.points_count,
            "vectors": info.config.params.vectors,
            "sparse": info.config.params.sparse_vectors,
            "raw": info,
        }
    except Exception:
        return None


# ─────────────────────────── DRY RUN ───────────────────────────
async def preview(collections: list[str]) -> None:
    src, tgt = make_clients()
    print("=" * 72)
    print("DRY RUN — Qdrant Cloud → VM 마이그레이션 미리보기")
    print("=" * 72)

    print("\n[소스 (Qdrant Cloud)]")
    src_totals: dict[str, int] = {}
    for name in collections:
        brief = await collection_brief(src, name)
        if not brief:
            print(f"  {name}: 없음 (스킵)")
            continue
        src_totals[name] = brief["points"]
        print(f"  {name}: {brief['points']:,} points")

    print("\n[타겟 (VM Qdrant)]")
    for name in collections:
        brief = await collection_brief(tgt, name)
        if not brief:
            print(f"  {name}: 없음 → 마이그레이션 시 생성")
        else:
            print(f"  {name}: {brief['points']:,} points (이미 존재)")

    state = load_state()
    if state:
        print("\n[체크포인트 발견]")
        for name, st in state.items():
            print(f"  {name}: uploaded={st.get('uploaded', 0):,} offset={st.get('offset')!r}")

    total = sum(src_totals.values())
    print(f"\n[총 이동 예정] {total:,} points")
    print("실제 실행: --execute 추가")

    await src.close()
    await tgt.close()


# ─────────────────────────── EXECUTE ───────────────────────────
async def ensure_target_collection(
    src: AsyncQdrantClient,
    tgt: AsyncQdrantClient,
    name: str,
) -> None:
    src_info = (await collection_brief(src, name))
    if not src_info:
        return
    tgt_info = await collection_brief(tgt, name)
    if tgt_info:
        return  # 이미 있음 — 스펙은 source-of-truth(create_collection_v2.py)로 사전 생성된 가정
    params = src_info["raw"].config.params
    await tgt.create_collection(
        collection_name=name,
        vectors_config=params.vectors,
        sparse_vectors_config=params.sparse_vectors,
        on_disk_payload=True,
    )
    print(f"    ✅ 타겟 컬렉션 생성: {name}")


async def migrate_collection(
    src: AsyncQdrantClient,
    tgt: AsyncQdrantClient,
    name: str,
    state: dict,
) -> None:
    src_info = await collection_brief(src, name)
    if not src_info:
        print(f"  ⚠️  {name}: 소스에 없음 → 스킵")
        return

    total = src_info["points"]
    coll_state = state.setdefault(name, {"uploaded": 0, "offset": None, "done": False})

    if coll_state.get("done"):
        print(f"  ✓ {name}: 이미 완료됨 (skipped — 재실행 시 --reset 으로 초기화)")
        return

    offset = coll_state.get("offset")
    uploaded = coll_state.get("uploaded", 0)
    buf: list[models.PointStruct] = []
    started = time.time()

    print(f"\n[{name}] {total:,} points 이전 시작 (재개 offset={offset!r})")

    while True:
        pts, offset = await src.scroll(
            collection_name=name,
            limit=SCROLL_LIMIT,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )
        for p in pts:
            if p.vector is None:
                continue
            buf.append(
                models.PointStruct(id=p.id, vector=p.vector, payload=p.payload)  # type: ignore[arg-type]
            )
            if len(buf) >= UPSERT_BATCH:
                # wait=True: qdrant 인덱싱 완료까지 대기 → 백로그 누적·OOM 방지
                await tgt.upsert(collection_name=name, points=buf, wait=True)
                uploaded += len(buf)
                buf.clear()

        # 페이지 단위로 체크포인트 저장
        coll_state["uploaded"] = uploaded
        coll_state["offset"] = offset
        save_state(state)

        if uploaded and uploaded % 2000 < SCROLL_LIMIT:
            elapsed = time.time() - started
            rate = uploaded / max(elapsed, 1e-9)
            eta = (total - uploaded) / max(rate, 1e-9)
            print(f"    ... {uploaded:,}/{total:,} ({rate:.0f}/s, ETA {eta/60:.1f}분)")

        if offset is None:
            break

    if buf:
        await tgt.upsert(collection_name=name, points=buf, wait=True)
        uploaded += len(buf)
        buf.clear()

    coll_state.update(uploaded=uploaded, offset=None, done=True)
    save_state(state)
    elapsed = time.time() - started
    print(f"  ✅ {name}: {uploaded:,} uploaded ({elapsed/60:.1f}분)")


async def execute(collections: list[str], reset: bool) -> None:
    src, tgt = make_clients()
    if reset and STATE_FILE.exists():
        STATE_FILE.unlink()
        print("체크포인트 초기화됨")

    state = load_state()

    print("=" * 72)
    print("EXECUTE — Qdrant Cloud → VM 마이그레이션")
    print("=" * 72)

    for name in collections:
        await ensure_target_collection(src, tgt, name)

    for name in collections:
        await migrate_collection(src, tgt, name, state)

    print("\n[최종 검증]")
    for name in collections:
        s = await collection_brief(src, name)
        t = await collection_brief(tgt, name)
        if s and t:
            ok = "✅" if s["points"] == t["points"] else "⚠️"
            print(f"  {ok} {name}: cloud={s['points']:,}  vm={t['points']:,}")

    await src.close()
    await tgt.close()
    print("\n🎉 마이그레이션 완료. backend/scripts/verify_migration.py 로 샘플 검증을 추가 실행하세요.")


# ─────────────────────────── ENTRY ───────────────────────────
def load_env() -> None:
    env_file = BACKEND_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k, v.strip().strip('"').strip("'"))


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--reset", action="store_true", help="체크포인트 초기화")
    parser.add_argument(
        "--collections",
        nargs="+",
        default=DEFAULT_COLLECTIONS,
        help=f"기본: {DEFAULT_COLLECTIONS}",
    )
    args = parser.parse_args()

    load_env()

    required = ["QDRANT_CLOUD_URL", "QDRANT_CLOUD_API_KEY", "QDRANT_VM_URL", "QDRANT_VM_API_KEY"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"ERROR: 환경변수 누락: {missing}", file=sys.stderr)
        sys.exit(2)

    if args.execute:
        await execute(args.collections, args.reset)
    else:
        await preview(args.collections)


if __name__ == "__main__":
    asyncio.run(main())
