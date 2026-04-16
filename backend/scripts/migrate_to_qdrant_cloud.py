"""로컬 Qdrant → Qdrant Cloud 이관 (말씀선집 1~30권 + 그 외 전부).

단계:
  1) Cloud 기존 컬렉션 삭제 (semantic_cache, malssum_poc if any)
  2) Cloud에 동일 스펙 컬렉션 생성 (dense 1536 cosine + sparse)
  3) 로컬 scroll → 필터 → cloud upsert (배치)

필터 규칙:
  - volume에 '말씀선집' 포함 + 숫자 1~30이면 유지
  - volume에 '말씀선집' 미포함 → 전부 유지
  - 위 외 (말씀선집 31권 이상) → 제외

사용:
  uv run python scripts/migrate_to_qdrant_cloud.py --dry-run
  uv run python scripts/migrate_to_qdrant_cloud.py --execute
"""
import argparse
import asyncio
import os
import re
import sys
from pathlib import Path

from qdrant_client import AsyncQdrantClient, models

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

KEEP_VOLUME_MAX = 30  # 말씀선집 N권까지 유지
BATCH = 200           # upsert 배치 크기 (네트워크 타임아웃 방지)
VOL_RE = re.compile(r"말씀선집\s*(\d+)")


def keep_point(payload: dict) -> bool:
    v = (payload or {}).get("volume") or ""
    m = VOL_RE.search(v)
    if not m:
        # 말씀선집 아님 → 유지
        return True
    return int(m.group(1)) <= KEEP_VOLUME_MAX


async def collection_info(client: AsyncQdrantClient, name: str) -> dict | None:
    try:
        info = await client.get_collection(name)
        return {
            "points": info.points_count,
            "vectors": info.config.params.vectors,
            "sparse": info.config.params.sparse_vectors,
        }
    except Exception:
        return None


async def preview():
    local = AsyncQdrantClient(url=os.environ["QDRANT_URL"])
    cloud = AsyncQdrantClient(
        url=os.environ["QCLOUD_URL"],
        api_key=os.environ["QCLOUD_API_KEY"],
    )

    print("=" * 70)
    print("DRY RUN — Qdrant 이관 미리보기")
    print("=" * 70)

    # 로컬 현황
    print("\n[로컬 Qdrant]")
    for c in ["malssum_poc", "semantic_cache"]:
        info = await collection_info(local, c)
        if info:
            print(f"  {c}: {info['points']:,} points, vectors={list(info['vectors'].keys()) if isinstance(info['vectors'], dict) else info['vectors']}, sparse={list((info['sparse'] or {}).keys())}")
        else:
            print(f"  {c}: 없음")

    # 필터링 시뮬레이션
    print("\n[필터링 결과 (예상)]")
    keep = 0
    drop = 0
    seonjip_keep = 0
    seonjip_drop = 0
    offset = None
    while True:
        pts, offset = await local.scroll(
            collection_name="malssum_poc",
            limit=5000, offset=offset,
            with_payload=["volume"], with_vectors=False,
        )
        for p in pts:
            v = (p.payload or {}).get("volume") or ""
            is_seonjip = "말씀선집" in v
            if keep_point(p.payload):
                keep += 1
                if is_seonjip:
                    seonjip_keep += 1
            else:
                drop += 1
                if is_seonjip:
                    seonjip_drop += 1
        if offset is None:
            break
    print(f"  유지: {keep:,} (말씀선집 1~{KEEP_VOLUME_MAX}: {seonjip_keep:,}, 기타: {keep-seonjip_keep:,})")
    print(f"  제외: {drop:,} (말씀선집 {KEEP_VOLUME_MAX+1}권+: {seonjip_drop:,})")
    print(f"  예상 디스크: ~{keep * 8 / 1024 / 1024:.0f} MB")
    print(f"  예상 RAM: ~{keep * 9 / 1024 / 1024:.0f} MB (무료 1GB 한도)")

    # Cloud 현황
    print("\n[Qdrant Cloud (이관 전)]")
    cloud_cols = await cloud.get_collections()
    for c in cloud_cols.collections:
        info = await collection_info(cloud, c.name)
        print(f"  {c.name}: {info['points'] if info else '?'} points  → DELETE 예정")

    print("\n[계획]")
    print(f"  1) Cloud 기존 컬렉션 전부 삭제")
    print(f"  2) malssum_poc 생성 (dense 1536 Cosine + sparse)")
    print(f"  3) semantic_cache 생성 (dense 1536 Cosine)")
    print(f"  4) 필터링된 {keep:,} + semantic_cache 전체 업로드")

    await local.close()
    await cloud.close()


async def execute():
    local = AsyncQdrantClient(url=os.environ["QDRANT_URL"])
    cloud = AsyncQdrantClient(
        url=os.environ["QCLOUD_URL"],
        api_key=os.environ["QCLOUD_API_KEY"],
    )

    print("=" * 70)
    print("EXECUTE — Qdrant Cloud 이관 시작")
    print("=" * 70)

    # 1. Cloud 기존 컬렉션 삭제
    print("\n[1/4] Cloud 기존 컬렉션 삭제")
    existing = await cloud.get_collections()
    for c in existing.collections:
        print(f"    DELETE {c.name}...")
        await cloud.delete_collection(c.name)
    print("    ✅ 완료")

    # 2. malssum_poc 생성 (스펙 복사)
    print("\n[2/4] Cloud 컬렉션 생성")
    local_info = await local.get_collection("malssum_poc")
    params = local_info.config.params
    await cloud.create_collection(
        collection_name="malssum_poc",
        vectors_config=params.vectors,
        sparse_vectors_config=params.sparse_vectors,
        on_disk_payload=True,
    )
    print(f"    ✅ malssum_poc (on_disk_payload=True)")

    local_cache = await local.get_collection("semantic_cache")
    await cloud.create_collection(
        collection_name="semantic_cache",
        vectors_config=local_cache.config.params.vectors,
        sparse_vectors_config=local_cache.config.params.sparse_vectors,
    )
    print(f"    ✅ semantic_cache")

    # 3. malssum_poc 필터 업로드
    print("\n[3/4] malssum_poc 업로드 (필터링)")
    offset = None
    uploaded = 0
    skipped = 0
    buf = []
    while True:
        pts, offset = await local.scroll(
            collection_name="malssum_poc",
            limit=500, offset=offset,
            with_payload=True, with_vectors=True,
        )
        for p in pts:
            if not keep_point(p.payload):
                skipped += 1
                continue
            buf.append(models.PointStruct(
                id=p.id,
                vector=p.vector,
                payload=p.payload,
            ))
            if len(buf) >= BATCH:
                await cloud.upsert(collection_name="malssum_poc", points=buf, wait=False)
                uploaded += len(buf)
                buf.clear()
                if uploaded % 2000 == 0:
                    print(f"    ... {uploaded:,} uploaded")
        if offset is None:
            break
    if buf:
        await cloud.upsert(collection_name="malssum_poc", points=buf, wait=True)
        uploaded += len(buf)
    print(f"    ✅ malssum_poc: {uploaded:,} uploaded, {skipped:,} skipped")

    # 4. semantic_cache 전체 업로드
    print("\n[4/4] semantic_cache 업로드 (전체)")
    offset = None
    uploaded_c = 0
    buf = []
    while True:
        pts, offset = await local.scroll(
            collection_name="semantic_cache",
            limit=500, offset=offset,
            with_payload=True, with_vectors=True,
        )
        for p in pts:
            buf.append(models.PointStruct(id=p.id, vector=p.vector, payload=p.payload))
        if offset is None:
            break
    if buf:
        await cloud.upsert(collection_name="semantic_cache", points=buf, wait=True)
        uploaded_c = len(buf)
    print(f"    ✅ semantic_cache: {uploaded_c} uploaded")

    # 검증
    print("\n[검증]")
    for name in ["malssum_poc", "semantic_cache"]:
        info = await cloud.get_collection(name)
        print(f"    {name}: {info.points_count:,} points on cloud")

    await local.close()
    await cloud.close()
    print("\n🎉 Qdrant Cloud 이관 완료")


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
