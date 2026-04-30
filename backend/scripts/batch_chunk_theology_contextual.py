"""신학/원리 5권 한정 Contextual Retrieval 적재 (Phase 4 PoC).

흐름:
1. matched.json 5권 → extract_text + extract_metadata + chunk_recursive
2. 각 청크에 대해 Gemini Flash Lite 로 Anthropic-style 컨텍스트 prefix 생성
   (asyncio.Semaphore concurrency, 권별 full_doc 캐시 in-memory)
3. chunk.prefix_text 주입 → ingest_chunks (ingestor 가 _build_text_for_embedding
   에서 자동 prepend)
4. 권별 prefix 결과 .jsonl 체크포인트 보존 (재시작 시 기존 prefix 재사용)

사용:
    PYTHONPATH=. uv run python scripts/batch_chunk_theology_contextual.py \\
        --matched-file ../tmp_match/matched.json \\
        --collection theology_poc_contextual_v1 \\
        [--concurrency 20] [--limit-volumes 1] [--dry-run]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import unicodedata
from pathlib import Path

from scripts.batch_chunk_theology import is_theology  # type: ignore[import-not-found]
from scripts.build_contextual_prefix import (
    PROMPT_TEMPLATE,
    parse_prefix_response,
)
from src.common.gemini import generate_text
from src.pipeline.chunker import chunk_recursive
from src.pipeline.extractor import extract_text
from src.pipeline.ingestor import ingest_chunks
from src.pipeline.metadata import extract_metadata


async def generate_prefix_for_chunks(
    chunks: list[dict],
    full_doc: str,
    semaphore: asyncio.Semaphore,
) -> None:
    """청크 리스트에 prefix_text in-place 주입. chunks dict 는 {chunk_index, text} 포함."""

    async def _one(c: dict) -> None:
        async with semaphore:
            prompt = PROMPT_TEMPLATE.format(
                full_doc=full_doc[:8000],
                chunk_text=str(c.get("text", ""))[:1500],
            )
            try:
                raw = await generate_text(
                    prompt, model="gemini-3.1-flash-lite-preview"
                )
                c["prefix_text"] = parse_prefix_response(raw)
            except Exception as exc:
                c["prefix_text"] = ""
                c["prefix_error"] = str(exc)

    await asyncio.gather(*(_one(c) for c in chunks))


async def process_volume(
    volume_key: str,
    raw_path: Path,
    source_tag: str,
    collection: str,
    semaphore: asyncio.Semaphore,
    checkpoint_dir: Path,
    dry_run: bool,
) -> dict:
    """단일 권 처리. checkpoint 가 존재하면 prefix 재사용."""
    text = extract_text(raw_path)
    meta = extract_metadata(raw_path, text)
    chunks_objs = chunk_recursive(
        text,
        volume=volume_key,
        source=source_tag,
        title=meta.get("title", ""),
        date=meta.get("date", ""),
    )

    chunk_dicts: list[dict] = [
        {"chunk_index": c.chunk_index, "text": c.text}
        for c in chunks_objs
    ]

    # checkpoint: 기존 prefix 가 있으면 재사용 (LLM 비용 보존)
    safe_volume = volume_key.replace("/", "_")
    cp_path = checkpoint_dir / f"prefix_{safe_volume}.jsonl"
    cp_path.parent.mkdir(parents=True, exist_ok=True)
    if cp_path.exists():
        existing: dict[int, str] = {}
        for line in cp_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                d = json.loads(line)
                if d.get("prefix_text"):
                    existing[int(d["chunk_index"])] = d["prefix_text"]
        for cd in chunk_dicts:
            if cd["chunk_index"] in existing:
                cd["prefix_text"] = existing[cd["chunk_index"]]
        missing = [c for c in chunk_dicts if not c.get("prefix_text")]
        print(
            f"  checkpoint hit: {len(existing)}/{len(chunk_dicts)} 재사용, "
            f"신규 {len(missing)}건 생성"
        )
    else:
        missing = chunk_dicts

    # 신규 prefix 생성
    if missing:
        full_doc = "\n".join(c["text"] for c in chunk_dicts)
        await generate_prefix_for_chunks(missing, full_doc, semaphore)
        # checkpoint 저장 (full chunks)
        with cp_path.open("w", encoding="utf-8") as f:
            for cd in chunk_dicts:
                f.write(json.dumps(cd, ensure_ascii=False) + "\n")

    # 누락 prefix 통계
    empty = sum(1 for c in chunk_dicts if not c.get("prefix_text"))
    if empty:
        print(f"  ⚠️  prefix 빈 청크: {empty}/{len(chunk_dicts)} (메타데이터 fallback 적용)")

    # Chunk 객체에 prefix_text 주입 + metadata fallback
    for chunk_obj, cd in zip(chunks_objs, chunk_dicts):
        prefix = cd.get("prefix_text", "") or ""
        if not prefix:
            # fallback — 누락 시 [volume / date] 메타 prefix
            prefix = f"[{volume_key} / {meta.get('date','')}]".strip(" /")
        chunk_obj.prefix_text = prefix

    if dry_run:
        return {
            "chunks": len(chunks_objs),
            "with_prefix": sum(1 for c in chunks_objs if c.prefix_text),
            "ingested": 0,
            "ingest_seconds": 0.0,
        }

    t0 = time.time()
    stats = ingest_chunks(
        collection_name=collection,
        chunks=chunks_objs,
        title=meta.get("title", "") or volume_key,
        payload_sources=[source_tag],
    )
    return {
        "chunks": len(chunks_objs),
        "with_prefix": sum(1 for c in chunks_objs if c.prefix_text),
        "ingested": stats.get("chunk_count", 0),
        "ingest_seconds": time.time() - t0,
    }


async def amain(args: argparse.Namespace) -> int:
    matched_all: list[dict] = json.loads(args.matched_file.read_text())
    matched = [
        m for m in matched_all
        if is_theology(m["raw_path"]) and not Path(m["raw_path"]).name.startswith("._")
    ]
    if args.limit_volumes:
        matched = matched[: args.limit_volumes]
    print(f"신학/원리 매칭 권 수: {len(matched)}")
    for m in matched:
        print(f"  - {m['volume']}")

    semaphore = asyncio.Semaphore(args.concurrency)

    success = 0
    failed = 0
    t0 = time.time()
    for i, m in enumerate(matched, 1):
        vol = unicodedata.normalize("NFC", m["volume"])
        raw_path = Path(m["raw_path"])
        if not raw_path.exists():
            print(f"[{i}/{len(matched)}] {vol}: SKIP (raw 파일 없음)")
            failed += 1
            continue
        try:
            print(f"[{i}/{len(matched)}] {vol}: 시작 (concurrency={args.concurrency})")
            result = await process_volume(
                volume_key=vol,
                raw_path=raw_path,
                source_tag=args.source_tag,
                collection=args.collection,
                semaphore=semaphore,
                checkpoint_dir=args.checkpoint_dir,
                dry_run=args.dry_run,
            )
            elapsed = time.time() - t0
            print(
                f"[{i}/{len(matched)}] {vol}: "
                f"{result['chunks']} 청크, prefix {result['with_prefix']}, "
                f"적재 {result['ingest_seconds']:.1f}s "
                f"(누계 {elapsed/60:.1f}분)",
                flush=True,
            )
            success += 1
        except Exception as e:
            print(f"[{i}/{len(matched)}] {vol}: FAILED — {type(e).__name__}: {e}",
                  flush=True)
            failed += 1

    print()
    print(f"=== 완료 (contextual → {args.collection}) ===")
    print(f"성공: {success} / 실패: {failed} / 총 {time.time()-t0:.1f}초")
    return 0 if failed == 0 else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--matched-file", required=True, type=Path)
    p.add_argument("--collection", required=True)
    p.add_argument("--source-tag", default="A")
    p.add_argument("--concurrency", type=int, default=10)
    p.add_argument("--limit-volumes", type=int, default=None,
                   help="처리할 권 수 제한 (smoke test 용)")
    p.add_argument(
        "--checkpoint-dir",
        type=Path,
        default=Path("../tmp_match/phase4_contextual_prefixes"),
        help="권별 prefix .jsonl 보존 디렉토리 (재시작 시 LLM 비용 절감)",
    )
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    return asyncio.run(amain(args))


if __name__ == "__main__":
    sys.exit(main())
