"""raw 매칭 권 일괄 paragraph 청킹 + **metadata prefix injection** + 임베딩 + Qdrant 적재.

옵션 v4 (paragraph + metadata prefix). dev-log 46 방안 A 구현.

기존 batch_chunk_paragraph.py와 동일한 흐름이지만, chunk_paragraph 결과의 모든 chunk에
metadata 기반 prefix를 prefix_text에 할당하여 임베딩에 결합한다.

prefix 형식: `[volume / date]` (date 누락 시 `[volume]`)
- volume: 권명 (파일 확장자 제거)
- date: extract_metadata로 추출 (없으면 생략)
- payload `text`는 원문 본문 그대로 (prefix 미포함)

사용:
    PYTHONPATH=. uv run python scripts/batch_chunk_paragraph_v4.py \\
        --matched-file ../tmp_match/matched.json \\
        --collection malssum_poc_v4 \\
        --src-collection malssum_poc \\
        --resume
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

from qdrant_client.models import FieldCondition, Filter, MatchValue

from scripts.chunking_poc import chunk_paragraph
from src.pipeline.extractor import extract_text
from src.pipeline.metadata import extract_metadata
from src.pipeline.ingestor import ingest_chunks
from src.qdrant_client import get_client


def fetch_source_for_volume(client, src_collection: str, volume: str) -> list[str] | str:
    """volume의 source payload를 src_collection에서 조회 (첫 청크 기준)."""
    flt = Filter(must=[FieldCondition(key="volume", match=MatchValue(value=volume))])
    points, _ = client.scroll(
        collection_name=src_collection,
        scroll_filter=flt,
        limit=1,
        with_payload=["source"],
        with_vectors=False,
    )
    if not points:
        return ""
    payload = points[0].payload or {}
    src = payload.get("source", "")
    return src if src else ""


def clean_volume_for_prefix(volume: str) -> str:
    """파일 확장자/잡음 제거 후 prefix용 volume 텍스트 생성."""
    cleaned = volume
    for ext in (".pdf", ".PDF", ".txt", ".TXT", ".docx", ".DOCX"):
        if cleaned.endswith(ext):
            cleaned = cleaned[: -len(ext)]
            break
    cleaned = cleaned.strip()
    return cleaned


def build_prefix(volume: str, date: str) -> str:
    """metadata prefix 생성. v4 형식: [volume / date] 또는 [volume]."""
    vol_clean = clean_volume_for_prefix(volume)
    if date:
        return f"[{vol_clean} / {date}]"
    return f"[{vol_clean}]"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matched-file", required=True, type=Path)
    parser.add_argument("--collection", default="malssum_poc_v4", help="대상 컬렉션 (paragraph + prefix 적재)")
    parser.add_argument("--src-collection", default="malssum_poc", help="기존 source 조회용")
    parser.add_argument(
        "--checkpoint",
        default=Path("../tmp_match/v4_progress.json"),
        type=Path,
    )
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true",
                        help="첫 1권만 처리하고 prefix/chunks 출력만 (적재 X)")
    args = parser.parse_args()

    matched: list[dict] = json.loads(args.matched_file.read_text())
    matched = [m for m in matched if not Path(m["raw_path"]).name.startswith("._")]
    if args.limit:
        matched = matched[: args.limit]
    print(f"매칭 권 수: {len(matched)} (._ 제외)")

    progress: dict[str, str] = {}
    if args.resume and args.checkpoint.exists():
        progress = json.loads(args.checkpoint.read_text())
        done_count = sum(1 for v in progress.values() if v == "done")
        print(f"resume: 이미 {done_count}권 완료, 나머지부터 재개")

    args.checkpoint.parent.mkdir(parents=True, exist_ok=True)

    client = get_client()

    success = 0
    failed = 0
    t0 = time.time()
    for i, m in enumerate(matched, 1):
        vol = m["volume"]
        if progress.get(vol) == "done":
            continue
        raw_path = Path(m["raw_path"])
        if not raw_path.exists():
            progress[vol] = "failed: file not found"
            failed += 1
            print(f"[{i}/{len(matched)}] {vol}: SKIP (raw 파일 없음)")
            args.checkpoint.write_text(json.dumps(progress, ensure_ascii=False, indent=2))
            continue
        try:
            text = extract_text(raw_path)
            meta = extract_metadata(raw_path, text)
            source = fetch_source_for_volume(client, args.src_collection, vol)
            chunks = chunk_paragraph(
                text,
                volume=vol,
                source=source if isinstance(source, str) else (source[0] if source else ""),
                title=meta.get("title", ""),
                date=meta.get("date", ""),
            )
            # v4 핵심: metadata prefix를 모든 chunk에 주입
            prefix = build_prefix(vol, meta.get("date", ""))
            for c in chunks:
                c.prefix_text = prefix

            payload_sources = source if isinstance(source, list) else None

            if args.dry_run:
                print(f"[DRY-RUN] {vol}: {len(chunks)} 청크")
                print(f"  prefix: {prefix}")
                if chunks:
                    sample = chunks[0]
                    print(f"  sample chunk[0].prefix_text: {sample.prefix_text}")
                    print(f"  sample chunk[0].text[:120]: {sample.text[:120]!r}")
                    print(f"  sample chunk[0].volume: {sample.volume}")
                    print(f"  sample chunk[0].date: {sample.date}")
                print()
                # dry-run은 첫 1권만 처리
                progress[vol] = "dry-run-ok"
                break

            stats = ingest_chunks(
                client=client,
                collection_name=args.collection,
                chunks=chunks,
                title=meta.get("title", "") or vol,
                payload_sources=payload_sources,
            )
            progress[vol] = "done"
            success += 1
            elapsed_total = time.time() - t0
            print(
                f"[{i}/{len(matched)}] {vol}: prefix={prefix[:60]!r} "
                f"{stats['chunk_count']} 청크, {stats['elapsed_sec']:.1f}s "
                f"(총 경과 {elapsed_total/60:.1f}분, 성공 {success} / 실패 {failed})",
                flush=True,
            )
        except Exception as e:
            progress[vol] = f"failed: {type(e).__name__}: {e}"
            failed += 1
            print(f"[{i}/{len(matched)}] {vol}: FAILED — {e}", flush=True)
        args.checkpoint.write_text(
            json.dumps(progress, ensure_ascii=False, indent=2)
        )

    print()
    print(f"=== 완료 ===")
    print(f"성공: {success} / 실패: {failed} / 총 {time.time()-t0:.1f}초")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
