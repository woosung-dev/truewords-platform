"""마이그레이션 검증 (raw httpx).

검증 항목:
  1. 컬렉션별 point count 동일성
  2. 무작위 샘플 N건의 vector·payload 일치 (cosine ≥ 0.999)

환경변수: migrate_cloud_to_vm.py 와 동일
사용:
  uv run python scripts/verify_migration.py
  uv run python scripts/verify_migration.py --sample 30 --collections malssum_poc_v5
"""
import argparse
import asyncio
import math
import os
import random
import sys
from pathlib import Path
from typing import Any

import httpx

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

DEFAULT_COLLECTIONS = ["malssum_poc", "semantic_cache"]
COSINE_THRESHOLD = 0.999


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


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def first_dense_vector(v: Any) -> list[float] | None:
    if isinstance(v, list):
        return v
    if isinstance(v, dict):
        for val in v.values():
            if isinstance(val, list):
                return val
    return None


class QdrantHttp:
    def __init__(self, base_url: str, api_key: str | None) -> None:
        self.base_url = base_url.rstrip("/")
        self.headers = {"api-key": api_key} if api_key else {}
        self.timeout = httpx.Timeout(60.0, connect=10.0)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(http2=False, timeout=self.timeout, headers=self.headers)

    async def get_collection(self, name: str) -> dict | None:
        async with self._client() as cli:
            r = await cli.get(f"{self.base_url}/collections/{name}")
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()["result"]

    async def exact_count(self, name: str) -> int:
        # ``points_count`` 필드는 segment-level approximate. 검증엔 exact 사용
        async with self._client() as cli:
            r = await cli.post(
                f"{self.base_url}/collections/{name}/points/count",
                json={"exact": True},
            )
            r.raise_for_status()
            return int(r.json()["result"]["count"])

    async def scroll_ids(
        self, name: str, *, limit: int, offset: Any | None
    ) -> tuple[list, Any]:
        body: dict[str, Any] = {
            "limit": limit,
            "with_payload": False,
            "with_vector": False,
        }
        if offset is not None:
            body["offset"] = offset
        async with self._client() as cli:
            r = await cli.post(
                f"{self.base_url}/collections/{name}/points/scroll", json=body
            )
            r.raise_for_status()
            d = r.json()["result"]
            return [p["id"] for p in d["points"]], d.get("next_page_offset")

    async def retrieve(self, name: str, ids: list) -> list[dict]:
        body = {"ids": ids, "with_payload": True, "with_vector": True}
        async with self._client() as cli:
            r = await cli.post(
                f"{self.base_url}/collections/{name}/points", json=body
            )
            r.raise_for_status()
            return r.json()["result"]


async def verify_collection(
    src: QdrantHttp, tgt: QdrantHttp, name: str, sample_size: int
) -> bool:
    s_info = await src.get_collection(name)
    t_info = await tgt.get_collection(name)
    if s_info is None or t_info is None:
        print(
            f"  ⚠️  {name}: 컬렉션 부재 "
            f"(src={s_info is not None}, tgt={t_info is not None})"
        )
        return False
    s_count = await src.exact_count(name)
    t_count = await tgt.exact_count(name)
    count_ok = s_count == t_count
    print(
        f"\n[{name}] count: src={s_count:,}  tgt={t_count:,}  "
        f"{'✅' if count_ok else '⚠️'}"
    )
    if not count_ok:
        print(f"     diff={s_count - t_count}")

    ids: list = []
    offset = None
    while len(ids) < max(sample_size * 20, 200):
        page_ids, offset = await src.scroll_ids(name, limit=500, offset=offset)
        ids.extend(page_ids)
        if offset is None:
            break

    if not ids:
        print(f"  ⚠️  {name}: 샘플링 가능한 포인트 없음")
        return count_ok

    sample_ids = random.sample(ids, min(sample_size, len(ids)))
    s_pts = await src.retrieve(name, sample_ids)
    t_pts = await tgt.retrieve(name, sample_ids)
    s_map = {p["id"]: p for p in s_pts}
    t_map = {p["id"]: p for p in t_pts}

    matched = vec_fail = payload_fail = missing = 0
    for pid in sample_ids:
        sp = s_map.get(pid)
        tp = t_map.get(pid)
        if sp is None or tp is None:
            missing += 1
            continue
        sv = first_dense_vector(sp.get("vector"))
        tv = first_dense_vector(tp.get("vector"))
        if sv is None or tv is None or len(sv) != len(tv):
            vec_fail += 1
            continue
        if cosine(sv, tv) < COSINE_THRESHOLD:
            vec_fail += 1
            continue
        if (sp.get("payload") or {}) != (tp.get("payload") or {}):
            payload_fail += 1
            continue
        matched += 1

    n = len(sample_ids)
    print(
        f"  샘플 {n}건: 일치 {matched}, vector불일치 {vec_fail}, "
        f"payload불일치 {payload_fail}, 누락 {missing}"
    )
    return count_ok and matched == n


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=10)
    parser.add_argument("--collections", nargs="+", default=DEFAULT_COLLECTIONS)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    load_env()
    random.seed(args.seed)
    required = ["QDRANT_CLOUD_URL", "QDRANT_VM_URL", "QDRANT_VM_API_KEY"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"ERROR: 환경변수 누락: {missing}", file=sys.stderr)
        sys.exit(2)

    src = QdrantHttp(
        os.environ["QDRANT_CLOUD_URL"],
        os.environ.get("QDRANT_CLOUD_API_KEY") or None,
    )
    tgt = QdrantHttp(
        os.environ["QDRANT_VM_URL"],
        os.environ.get("QDRANT_VM_API_KEY") or None,
    )

    print("=" * 72)
    print("Migration Verification (raw httpx)")
    print("=" * 72)

    all_ok = True
    for name in args.collections:
        ok = await verify_collection(src, tgt, name, args.sample)
        all_ok = all_ok and ok

    print("\n" + ("🎉 검증 통과" if all_ok else "⚠️  검증 실패 — 위 로그 참고"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
