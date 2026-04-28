"""Prefix가 부여된 권별 JSONL을 malssum_poc_v2에 재인덱싱 (옵션 B).

Group C가 생성한 ``contextual_prefixes/<volume>.jsonl``을 입력으로,
``Chunk.prefix_text`` 필드를 살려 ingest_chunks(..., collection_name='malssum_poc_v2')에
적재. ingestor.py의 _build_text_for_embedding이 prefix를 자동 prepend.

사용 예 (1권 sanity):
    PYTHONPATH=. uv run python scripts/reindex_with_prefix.py \\
        --input ~/Downloads/contextual_prefix_dryrun_평화경_20260428_1146.jsonl

사용 예 (전체 615권):
    PYTHONPATH=. uv run python scripts/reindex_with_prefix.py \\
        --input-dir ~/Downloads/contextual_prefixes
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from src.pipeline.chunker import Chunk
from src.pipeline.ingestor import ingest_chunks
from src.qdrant_client import get_client


COLLECTION_V2 = "malssum_poc_v2"


def jsonl_to_chunks(path: Path) -> list[Chunk]:
    """권별 JSONL → Chunk 리스트 (없거나 비어있으면 빈 리스트)."""
    if not path.exists() or path.stat().st_size == 0:
        return []
    out: list[Chunk] = []
    for line in path.open("r", encoding="utf-8"):
        if not line.strip():
            continue
        d = json.loads(line)
        out.append(Chunk(
            text=d.get("text", ""),
            volume=d.get("volume", ""),
            chunk_index=d.get("chunk_index", 0),
            source=d.get("source", ""),
            title=d.get("title", ""),
            date=d.get("date", ""),
            prefix_text=d.get("prefix_text", ""),
        ))
    return out


def reindex_volume(path: Path) -> None:
    client = get_client()
    chunks = jsonl_to_chunks(path)
    if not chunks:
        print(f"skip empty: {path.name}")
        return
    title = chunks[0].title or chunks[0].volume
    stats = ingest_chunks(client, COLLECTION_V2, chunks, start_chunk=0, title=title)
    print(f"완료 {path.name}: {stats}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, help="단일 prefix JSONL")
    p.add_argument("--input-dir", type=Path, help="contextual_prefixes 디렉토리")
    args = p.parse_args()
    if args.input:
        reindex_volume(args.input)
    elif args.input_dir:
        for f in sorted(args.input_dir.glob("*.jsonl")):
            reindex_volume(f)
    else:
        raise SystemExit("--input 또는 --input-dir 필요")
    return 0


if __name__ == "__main__":
    sys.exit(main())
