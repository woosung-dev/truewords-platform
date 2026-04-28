"""Qdrant 컬렉션의 모든 청크를 권별 JSONL로 덤프 (옵션 B prefix 생성용 입력).

사용 예 (전체 615권):
    PYTHONPATH=. uv run python scripts/dump_chunks_to_jsonl.py \\
        --collection malssum_poc \\
        --output-dir /tmp/all_chunks_jsonl

출력 포맷: 권별 ``{volume_slug}.jsonl`` (chunk_index 오름차순 정렬).
build_contextual_prefix.py --input-dir 가 그대로 소비하는 스키마.
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from src.qdrant_client import get_client


_INVALID_FS_CHARS = '/\\:?*<>|"'


def slugify_volume(name: str) -> str:
    """파일시스템 안전 슬러그 (Korean 문자 보존, 위험 문자만 _로 치환)."""
    for ch in _INVALID_FS_CHARS:
        name = name.replace(ch, "_")
    return name.strip() or "_unknown"


def dump_chunks(
    client: Any, collection: str, output_dir: Path, batch_size: int = 1000
) -> dict[str, int]:
    """Qdrant scroll → 권별 grouping → JSONL 직렬화. {volume: count} 반환.

    payload는 chunk_index 순서로 정렬해 입력 청크 순서를 보존한다.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    by_volume: dict[str, list[dict]] = defaultdict(list)
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=collection,
            with_payload=True,
            with_vectors=False,
            limit=batch_size,
            offset=offset,
        )
        if not points:
            break
        for p in points:
            payload = dict(p.payload or {})
            vol = str(payload.get("volume", "_unknown") or "_unknown")
            by_volume[vol].append(payload)
        if offset is None:
            break

    counts: dict[str, int] = {}
    used_keys: set[str] = set()
    for vol, entries in by_volume.items():
        entries.sort(key=lambda d: int(d.get("chunk_index", 0) or 0))
        slug = slugify_volume(vol)
        # macOS FS는 NFC/NFD를 같은 경로로 취급 — NFC 정규화한 키로 충돌 검사 후
        # 충돌 시 _dupN 접미사로 모든 청크 보존 (A/B 평가 데이터 일치 유지).
        candidate = f"{slug}.jsonl"
        key = unicodedata.normalize("NFC", candidate)
        suffix = 0
        while key in used_keys:
            suffix += 1
            candidate = f"{slug}_dup{suffix}.jsonl"
            key = unicodedata.normalize("NFC", candidate)
        used_keys.add(key)
        out_path = output_dir / candidate
        with out_path.open("w", encoding="utf-8") as f:
            for d in entries:
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
        counts[vol] = len(entries)
    return counts


def _format_summary(counts: dict[str, int]) -> Iterable[str]:
    yield f"권 수: {len(counts)}"
    yield f"총 청크 수: {sum(counts.values())}"
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:5]
    yield "상위 5권: " + ", ".join(f"{v}({n})" for v, n in top)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--collection", type=str, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--batch-size", type=int, default=1000)
    args = p.parse_args()

    client = get_client()
    counts = dump_chunks(client, args.collection, args.output_dir, args.batch_size)
    for line in _format_summary(counts):
        print(line, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
