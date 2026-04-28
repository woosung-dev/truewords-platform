"""마이그레이션 검증: Qdrant Cloud(소스) ↔ VM(타겟) 일치성 확인.

검증 항목
  1. 컬렉션별 point count 동일성
  2. 무작위 샘플 N건의 vector·payload 일치 (cosine 유사도 ≥ 0.999)

환경변수 (migrate_cloud_to_vm.py 와 동일):
  QDRANT_CLOUD_URL, QDRANT_CLOUD_API_KEY, QDRANT_VM_URL, QDRANT_VM_API_KEY

사용:
  uv run python scripts/verify_migration.py
  uv run python scripts/verify_migration.py --sample 20
"""
import argparse
import asyncio
import math
import os
import random
import sys
from pathlib import Path

from qdrant_client import AsyncQdrantClient

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


def first_dense_vector(v: object) -> list[float] | None:
    """단일 vector 또는 named-vector dict에서 dense 벡터 추출."""
    if isinstance(v, list):
        return v
    if isinstance(v, dict):
        for val in v.values():
            if isinstance(val, list):
                return val
    return None


async def verify_collection(
    src: AsyncQdrantClient,
    tgt: AsyncQdrantClient,
    name: str,
    sample_size: int,
) -> bool:
    try:
        s_info = await src.get_collection(name)
        t_info = await tgt.get_collection(name)
    except Exception as e:
        print(f"  ⚠️  {name}: 컬렉션 조회 실패 ({e})")
        return False

    s_count = s_info.points_count or 0
    t_count = t_info.points_count or 0
    count_ok = s_count == t_count
    print(f"\n[{name}] count: cloud={s_count:,}  vm={t_count:,}  {'✅' if count_ok else '⚠️'}")
    if not count_ok:
        print(f"     diff={s_count - t_count}")

    # 샘플 ID 수집 (소스에서 scroll 한 번 → ID만 모아서 random sample)
    ids: list = []
    offset = None
    while len(ids) < max(sample_size * 20, 200):
        pts, offset = await src.scroll(
            collection_name=name,
            limit=500,
            offset=offset,
            with_payload=False,
            with_vectors=False,
        )
        ids.extend(p.id for p in pts)
        if offset is None:
            break

    if not ids:
        print(f"  ⚠️  {name}: 샘플링 가능한 포인트 없음")
        return count_ok

    sample_ids = random.sample(ids, min(sample_size, len(ids)))
    s_pts = await src.retrieve(collection_name=name, ids=sample_ids,
                               with_payload=True, with_vectors=True)
    t_pts = await tgt.retrieve(collection_name=name, ids=sample_ids,
                               with_payload=True, with_vectors=True)

    s_map = {p.id: p for p in s_pts}
    t_map = {p.id: p for p in t_pts}

    matched = 0
    vec_fail = 0
    payload_fail = 0
    missing = 0

    for pid in sample_ids:
        sp = s_map.get(pid)
        tp = t_map.get(pid)
        if sp is None or tp is None:
            missing += 1
            continue
        sv = first_dense_vector(sp.vector)
        tv = first_dense_vector(tp.vector)
        if sv is None or tv is None or len(sv) != len(tv):
            vec_fail += 1
            continue
        sim = cosine(sv, tv)
        if sim < COSINE_THRESHOLD:
            vec_fail += 1
            continue
        if (sp.payload or {}) != (tp.payload or {}):
            payload_fail += 1
            continue
        matched += 1

    n = len(sample_ids)
    print(f"  샘플 {n}건: 일치 {matched}, vector불일치 {vec_fail}, payload불일치 {payload_fail}, 누락 {missing}")
    sample_ok = (matched == n)
    return count_ok and sample_ok


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=10, help="컬렉션당 샘플 수 (default 10)")
    parser.add_argument("--collections", nargs="+", default=DEFAULT_COLLECTIONS)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    load_env()
    random.seed(args.seed)

    required = ["QDRANT_CLOUD_URL", "QDRANT_CLOUD_API_KEY", "QDRANT_VM_URL", "QDRANT_VM_API_KEY"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"ERROR: 환경변수 누락: {missing}", file=sys.stderr)
        sys.exit(2)

    src = AsyncQdrantClient(
        url=os.environ["QDRANT_CLOUD_URL"],
        api_key=os.environ["QDRANT_CLOUD_API_KEY"],
        timeout=60,
    )
    tgt = AsyncQdrantClient(
        url=os.environ["QDRANT_VM_URL"],
        api_key=os.environ["QDRANT_VM_API_KEY"],
        timeout=60,
    )

    print("=" * 72)
    print("Migration Verification — Cloud ↔ VM")
    print("=" * 72)

    all_ok = True
    for name in args.collections:
        ok = await verify_collection(src, tgt, name, args.sample)
        all_ok = all_ok and ok

    await src.close()
    await tgt.close()

    print("\n" + ("🎉 검증 통과" if all_ok else "⚠️  검증 실패 — 위 로그 참고"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
