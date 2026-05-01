"""raw 매칭 권 일괄 paragraph 청킹 + 임베딩 + Qdrant 적재 (옵션 F 본 가동).

체크포인트(권별 완료 마킹) + --resume + retry-failed 패턴.
source는 매칭된 volume의 malssum_poc payload에서 그대로 사용 (운영 일관성).

사용:
    PYTHONPATH=. uv run python scripts/batch_chunk_paragraph.py \\
        --matched-file ../tmp_match/matched.json \\
        --collection malssum_poc_v3 \\
        --src-collection malssum_poc \\
        --resume
"""
from __future__ import annotations

import argparse
import json
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
    """volume의 source payload를 malssum_poc에서 조회 (첫 청크 기준).

    반환: source 리스트 (예: ['A', 'M']) 또는 빈 문자열.
    """
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matched-file", required=True, type=Path)
    parser.add_argument("--collection", default="malssum_poc_v3", help="대상 컬렉션 (paragraph 적재)")
    parser.add_argument("--src-collection", default="malssum_poc", help="기존 source 조회용")
    parser.add_argument(
        "--checkpoint",
        default=Path("../tmp_match/v3_progress.json"),
        type=Path,
    )
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    matched: list[dict] = json.loads(args.matched_file.read_text())
    # macOS resource fork 파일 제외 (._로 시작)
    matched = [m for m in matched if not Path(m["raw_path"]).name.startswith("._")]
    if args.limit:
        matched = matched[: args.limit]
    print(f"매칭 권 수: {len(matched)} (._ 제외)")

    # 진행 체크포인트 로드
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
            progress[vol] = f"failed: file not found"
            failed += 1
            print(f"[{i}/{len(matched)}] {vol}: SKIP (raw 파일 없음)")
            args.checkpoint.write_text(json.dumps(progress, ensure_ascii=False, indent=2))
            continue
        try:
            text = extract_text(raw_path)
            meta = extract_metadata(raw_path, text)
            # source는 운영 일관성을 위해 기존 payload 그대로 사용
            source = fetch_source_for_volume(client, args.src_collection, vol)
            chunks = chunk_paragraph(
                text,
                volume=vol,
                source=source if isinstance(source, str) else (source[0] if source else ""),
                title=meta.get("title", ""),
                date=meta.get("date", ""),
            )
            # source가 list 형태면 적재 시 list로 보존
            payload_sources = source if isinstance(source, list) else None

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
                f"[{i}/{len(matched)}] {vol}: "
                f"{stats['chunk_count']} 청크, {stats['elapsed_sec']:.1f}s "
                f"(총 경과 {elapsed_total/60:.1f}분, 성공 {success} / 실패 {failed})"
            )
        except Exception as e:
            progress[vol] = f"failed: {type(e).__name__}: {e}"
            failed += 1
            print(f"[{i}/{len(matched)}] {vol}: FAILED — {e}")
        # 체크포인트 저장 (매 권마다)
        args.checkpoint.write_text(
            json.dumps(progress, ensure_ascii=False, indent=2)
        )

    print()
    print(f"=== 완료 ===")
    print(f"성공: {success} / 실패: {failed} / 총 {time.time()-t0:.1f}초")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
