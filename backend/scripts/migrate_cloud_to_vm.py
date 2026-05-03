"""Qdrant 멱등 마이그레이션 (raw httpx, Cloudflare Tunnel 호환).

ADR-47 (PR #84/#86) 의 raw httpx 패턴 적용. SDK 의 HTTP/2 hang 회피.
체크포인트(`.migration_state.json`)로 중단 후 재개 가능.

환경변수 (backend/.env 또는 셸):
  QDRANT_CLOUD_URL       소스 URL
  QDRANT_CLOUD_API_KEY   소스 API key (없으면 None)
  QDRANT_VM_URL          타겟 URL
  QDRANT_VM_API_KEY      타겟 API key

사용:
  uv run python scripts/migrate_cloud_to_vm.py --dry-run --collections malssum_poc_v5
  uv run python scripts/migrate_cloud_to_vm.py --execute --collections malssum_poc_v5
  uv run python scripts/migrate_cloud_to_vm.py --execute --reset
"""
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

STATE_FILE = Path(__file__).resolve().parent / ".migration_state.json"
SCROLL_LIMIT = 500
UPSERT_BATCH = 100
DEFAULT_COLLECTIONS = ["malssum_poc", "semantic_cache"]


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


class QdrantHttp:
    """Cloudflare Tunnel 호환 raw httpx Qdrant 클라이언트 (마이그레이션 일회성)."""

    def __init__(self, base_url: str, api_key: str | None) -> None:
        self.base_url = base_url.rstrip("/")
        self.headers = {"api-key": api_key} if api_key else {}
        self.timeout = httpx.Timeout(300.0, connect=10.0)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(http2=False, timeout=self.timeout, headers=self.headers)

    async def get_collection(self, name: str) -> dict | None:
        async with self._client() as cli:
            r = await cli.get(f"{self.base_url}/collections/{name}")
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()["result"]

    async def create_collection(self, name: str, params: dict) -> None:
        body: dict = {}
        if params.get("vectors"):
            body["vectors"] = params["vectors"]
        if params.get("sparse_vectors"):
            body["sparse_vectors"] = params["sparse_vectors"]
        body["on_disk_payload"] = True
        async with self._client() as cli:
            r = await cli.put(f"{self.base_url}/collections/{name}", json=body)
            r.raise_for_status()

    async def create_payload_index(self, name: str, field_name: str, field_schema: str) -> None:
        async with self._client() as cli:
            r = await cli.put(
                f"{self.base_url}/collections/{name}/index?wait=true",
                json={"field_name": field_name, "field_schema": field_schema},
            )
            r.raise_for_status()

    async def scroll(
        self, name: str, *, limit: int, offset: Any | None = None, with_vector: bool = True
    ) -> tuple[list[dict], Any | None]:
        body: dict[str, Any] = {
            "limit": limit,
            "with_payload": True,
            "with_vector": with_vector,
        }
        if offset is not None:
            body["offset"] = offset
        async with self._client() as cli:
            r = await cli.post(
                f"{self.base_url}/collections/{name}/points/scroll", json=body
            )
            r.raise_for_status()
            data = r.json()["result"]
            return data["points"], data.get("next_page_offset")

    async def upsert(self, name: str, points: list[dict]) -> None:
        async with self._client() as cli:
            r = await cli.put(
                f"{self.base_url}/collections/{name}/points?wait=true",
                json={"points": points},
            )
            r.raise_for_status()


def make_clients() -> tuple[QdrantHttp, QdrantHttp]:
    src = QdrantHttp(
        os.environ["QDRANT_CLOUD_URL"],
        os.environ.get("QDRANT_CLOUD_API_KEY") or None,
    )
    tgt = QdrantHttp(
        os.environ["QDRANT_VM_URL"],
        os.environ.get("QDRANT_VM_API_KEY") or None,
    )
    return src, tgt


async def collection_brief(client: QdrantHttp, name: str) -> dict | None:
    info = await client.get_collection(name)
    if info is None:
        return None
    params = info["config"]["params"]
    return {
        "points": info.get("points_count") or 0,
        "vectors": params.get("vectors"),
        "sparse": params.get("sparse_vectors"),
        "params": params,
        "payload_schema": info.get("payload_schema") or {},
    }


# ─────────────────────────── DRY RUN ───────────────────────────
async def preview(collections: list[str]) -> None:
    src, tgt = make_clients()
    print("=" * 72)
    print("DRY RUN — Qdrant migration (raw httpx)")
    print("=" * 72)

    print("\n[소스]")
    src_totals: dict[str, int] = {}
    for name in collections:
        brief = await collection_brief(src, name)
        if not brief:
            print(f"  {name}: 없음 (스킵)")
            continue
        src_totals[name] = brief["points"]
        print(
            f"  {name}: {brief['points']:,} points  "
            f"vectors={brief['vectors']}  sparse={brief['sparse']}"
        )
        if brief["payload_schema"]:
            print(f"    payload_schema: {list(brief['payload_schema'].keys())}")

    print("\n[타겟]")
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
            print(
                f"  {name}: uploaded={st.get('uploaded', 0):,} "
                f"offset={st.get('offset')!r} done={st.get('done')}"
            )

    total = sum(src_totals.values())
    print(f"\n[총 이동 예정] {total:,} points")
    print("실제 실행: --execute 추가")


# ─────────────────────────── EXECUTE ───────────────────────────
async def ensure_target_collection(
    src: QdrantHttp, tgt: QdrantHttp, name: str
) -> None:
    src_brief = await collection_brief(src, name)
    if not src_brief:
        return
    tgt_brief = await collection_brief(tgt, name)
    if tgt_brief:
        return
    await tgt.create_collection(name, src_brief["params"])
    print(f"    ✅ 타겟 컬렉션 생성: {name}")
    # payload index 동기화
    for field, schema in src_brief["payload_schema"].items():
        if not isinstance(schema, dict):
            continue
        dt = schema.get("data_type")
        if not dt:
            continue
        try:
            await tgt.create_payload_index(name, field, dt)
            print(f"    ✅ payload index 생성: {field} ({dt})")
        except Exception as e:
            print(f"    ⚠️  payload index 실패: {field} ({dt}) — {e}")


async def migrate_collection(
    src: QdrantHttp, tgt: QdrantHttp, name: str, state: dict
) -> None:
    src_brief = await collection_brief(src, name)
    if not src_brief:
        print(f"  ⚠️  {name}: 소스에 없음 → 스킵")
        return

    total = src_brief["points"]
    coll_state = state.setdefault(name, {"uploaded": 0, "offset": None, "done": False})

    if coll_state.get("done"):
        print(f"  ✓ {name}: 이미 완료됨 (--reset 으로 초기화 가능)")
        return

    offset = coll_state.get("offset")
    uploaded = coll_state.get("uploaded", 0)
    buf: list[dict] = []
    started = time.time()

    print(f"\n[{name}] {total:,} points 이전 시작 (재개 offset={offset!r})")

    while True:
        pts, offset = await src.scroll(name, limit=SCROLL_LIMIT, offset=offset)
        for p in pts:
            if p.get("vector") is None:
                continue
            buf.append(
                {
                    "id": p["id"],
                    "vector": p["vector"],
                    "payload": p.get("payload") or {},
                }
            )
            if len(buf) >= UPSERT_BATCH:
                await tgt.upsert(name, buf)
                uploaded += len(buf)
                buf.clear()

        coll_state["uploaded"] = uploaded
        coll_state["offset"] = offset
        save_state(state)

        if uploaded and uploaded % 2000 < SCROLL_LIMIT:
            elapsed = time.time() - started
            rate = uploaded / max(elapsed, 1e-9)
            eta = (total - uploaded) / max(rate, 1e-9)
            print(
                f"    ... {uploaded:,}/{total:,} "
                f"({rate:.0f}/s, ETA {eta/60:.1f}분)"
            )

        if offset is None:
            break

    if buf:
        await tgt.upsert(name, buf)
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
    print("EXECUTE — Qdrant migration (raw httpx)")
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
            print(f"  {ok} {name}: src={s['points']:,}  tgt={t['points']:,}")

    print(
        "\n🎉 마이그레이션 완료. backend/scripts/verify_migration.py 로 샘플 검증."
    )


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
        "--collections", nargs="+", default=DEFAULT_COLLECTIONS,
        help=f"기본: {DEFAULT_COLLECTIONS}",
    )
    args = parser.parse_args()

    load_env()
    required = ["QDRANT_CLOUD_URL", "QDRANT_VM_URL", "QDRANT_VM_API_KEY"]
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
