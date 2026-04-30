"""신학/원리 5권 한정 batch 청킹 + 임베딩 + Qdrant 적재.

Phase 2.3 (dev-log 50) — A vs F vs Recursive 3방식 비교 PoC.

원리강론(1) + 3대경전(2) + 통일사상요강(2) = 5권 한정.
임베딩 비용 절감 + 신학/원리 핵심 텍스트만으로 청킹 영향 검증.

사용:
    PYTHONPATH=. uv run python scripts/batch_chunk_theology.py \\
        --matched-file ../tmp_match/matched.json \\
        --method recursive \\
        --collection theology_poc_recursive
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import unicodedata
from pathlib import Path

from src.pipeline.chunker import chunk_text, chunk_paragraph, chunk_recursive
from src.pipeline.extractor import extract_text
from src.pipeline.metadata import extract_metadata
from src.pipeline.ingestor import ingest_chunks
from src.qdrant_client import get_client


THEOLOGY_KEYWORDS = ["원리강론", "3대경전", "통일사상요강"]


def is_theology(raw_path: str) -> bool:
    """raw_path가 신학/원리 폴더에 속하는지 NFC/NFD 정규화 매칭."""
    p_nfc = unicodedata.normalize("NFC", raw_path)
    p_nfd = unicodedata.normalize("NFD", raw_path)
    for kw in THEOLOGY_KEYWORDS:
        kw_nfc = unicodedata.normalize("NFC", kw)
        kw_nfd = unicodedata.normalize("NFD", kw)
        if kw_nfc in p_nfc or kw_nfd in p_nfd:
            return True
    return False


def get_chunker(method: str):
    if method == "sentence":
        # max_chars=500 — 운영 sentence baseline
        return lambda text, **kw: chunk_text(text, max_chars=500, **kw)
    if method == "paragraph":
        return chunk_paragraph
    if method == "recursive":
        return chunk_recursive
    raise ValueError(f"Unknown method: {method}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matched-file", required=True, type=Path)
    parser.add_argument("--method", required=True,
                        choices=["sentence", "paragraph", "recursive"])
    parser.add_argument("--collection", required=True,
                        help="대상 Qdrant 컬렉션 (사전 생성 필요)")
    parser.add_argument("--source-tag", default="A",
                        help="신학/원리 source tag (기본 A)")
    parser.add_argument(
        "--checkpoint-dir",
        default=Path("../tmp_match"),
        type=Path,
    )
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    matched_all: list[dict] = json.loads(args.matched_file.read_text())
    # 신학/원리 5권 필터 + macOS resource fork(._) 제외
    matched = [
        m for m in matched_all
        if is_theology(m["raw_path"]) and not Path(m["raw_path"]).name.startswith("._")
    ]
    if args.limit:
        matched = matched[: args.limit]
    print(f"신학/원리 매칭 권 수: {len(matched)}")
    for m in matched:
        print(f"  - {m['volume']}")

    chunker = get_chunker(args.method)

    checkpoint = args.checkpoint_dir / f"theology_{args.method}_progress.json"
    progress: dict[str, str] = {}
    if args.resume and checkpoint.exists():
        progress = json.loads(checkpoint.read_text())
        done = sum(1 for v in progress.values() if v == "done")
        print(f"resume: {done}권 완료")
    args.checkpoint_dir.mkdir(parents=True, exist_ok=True)

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
            checkpoint.write_text(json.dumps(progress, ensure_ascii=False, indent=2))
            continue
        try:
            text = extract_text(raw_path)
            meta = extract_metadata(raw_path, text)
            chunks = chunker(
                text,
                volume=vol,
                source=args.source_tag,
                title=meta.get("title", ""),
                date=meta.get("date", ""),
            )

            if args.dry_run:
                print(f"[DRY-RUN][{i}/{len(matched)}] {vol}: {len(chunks)} 청크 "
                      f"(avg {sum(len(c.text) for c in chunks)/max(len(chunks),1):.0f}자)")
                progress[vol] = "dry-run-ok"
                continue

            stats = ingest_chunks(
                client=client,
                collection_name=args.collection,
                chunks=chunks,
                title=meta.get("title", "") or vol,
                payload_sources=[args.source_tag],
            )
            progress[vol] = "done"
            success += 1
            elapsed_total = time.time() - t0
            print(
                f"[{i}/{len(matched)}] {vol}: "
                f"{stats['chunk_count']} 청크, {stats['elapsed_sec']:.1f}s "
                f"(총 경과 {elapsed_total/60:.1f}분, 성공 {success} / 실패 {failed})",
                flush=True,
            )
        except Exception as e:
            progress[vol] = f"failed: {type(e).__name__}: {e}"
            failed += 1
            print(f"[{i}/{len(matched)}] {vol}: FAILED — {e}", flush=True)
        checkpoint.write_text(json.dumps(progress, ensure_ascii=False, indent=2))

    print()
    print(f"=== 완료 ({args.method} → {args.collection}) ===")
    print(f"성공: {success} / 실패: {failed} / 총 {time.time()-t0:.1f}초")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
