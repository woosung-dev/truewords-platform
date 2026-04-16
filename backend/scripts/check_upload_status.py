"""업로드 상태 진단 스크립트.

progress.json 없이 Qdrant + 원본 파일만으로 적재 상태를 확인한다.

사용법:
    # 1) Qdrant만 조회 (청크 수 + index 연속성 체크)
    uv run python scripts/check_upload_status.py

    # 2) 원본 파일과 비교 (총 청크 수 대조)
    uv run python scripts/check_upload_status.py /path/to/source/files
"""

import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

from qdrant_client import QdrantClient

from src.config import settings
from src.pipeline.chunker import chunk_text
from src.pipeline.extractor import extract_text


def fetch_qdrant_state() -> dict[str, dict]:
    """Qdrant에서 volume별 chunk_index 세트 추출.

    Returns:
        {volume: {"count": N, "max_index": M, "indices": set[int]}}
    """
    client = QdrantClient(url=settings.qdrant_url)
    collection = settings.collection_name

    offset = None
    state: dict[str, dict] = defaultdict(
        lambda: {"count": 0, "indices": set()}
    )
    while True:
        points, next_offset = client.scroll(
            collection_name=collection,
            limit=1000,
            offset=offset,
            with_payload=["volume", "chunk_index"],
        )
        if not points:
            break
        for p in points:
            vol = p.payload.get("volume", "UNKNOWN")
            idx = p.payload.get("chunk_index", -1)
            state[vol]["count"] += 1
            state[vol]["indices"].add(idx)
        if next_offset is None:
            break
        offset = next_offset

    for vol, s in state.items():
        s["max_index"] = max(s["indices"]) if s["indices"] else -1
        # 연속성 체크: indices가 {0, 1, ..., max_index}와 같은가?
        expected = set(range(s["max_index"] + 1))
        s["missing"] = sorted(expected - s["indices"])[:5]  # 최대 5개만
        s["is_sequential"] = len(s["missing"]) == 0

    return state


def count_expected_chunks(file_path: Path) -> int | None:
    """원본 파일을 재청킹하여 예상 총 청크 수 반환. 실패 시 None."""
    try:
        text = extract_text(file_path)
        if not text.strip():
            return 0
        chunks = chunk_text(
            text,
            volume=file_path.name,
            max_chars=500,
            source="",
            title="",
            date="",
        )
        return len(chunks)
    except Exception as e:
        print(f"  [ERROR] {file_path.name}: {e}", file=sys.stderr)
        return None


def main():
    state = fetch_qdrant_state()
    total_points = sum(s["count"] for s in state.values())

    print(f"=== Qdrant 전체 상태 ===")
    print(f"총 포인트: {total_points:,}개")
    print(f"파일 수: {len(state)}\n")

    # 원본 파일 디렉토리가 주어지면 대조
    source_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if source_dir and not source_dir.is_dir():
        print(f"[ERROR] 디렉토리 아님: {source_dir}")
        return

    if source_dir:
        print(f"원본 파일 디렉토리: {source_dir}\n")
        source_files = {
            unicodedata.normalize("NFC", f.name): f
            for f in source_dir.iterdir()
            if f.is_file() and f.suffix.lower() in {".txt", ".pdf", ".docx"}
        }

        complete: list[str] = []
        partial: list[str] = []
        over: list[str] = []
        no_source: list[str] = []

        # Qdrant에 있는 파일만 대상 (미업로드는 제외)
        for vol_key, qdrant_data in state.items():
            nfc_vol = unicodedata.normalize("NFC", vol_key)
            actual = qdrant_data["count"]
            if actual == 0:
                continue

            src_file = source_files.get(nfc_vol)
            if src_file is None:
                no_source.append(f"{actual:>5} {nfc_vol}")
                continue

            expected = count_expected_chunks(src_file)
            if expected is None:
                no_source.append(f"{actual:>5} {nfc_vol} (원본 처리 실패)")
                continue

            if actual == expected:
                complete.append(f"{actual:>5}/{expected}  {nfc_vol}")
            elif actual < expected:
                pct = actual / expected * 100
                partial.append(f"{actual:>5}/{expected} ({pct:.0f}%)  {nfc_vol}")
            else:
                over.append(f"{actual:>5}/{expected} (초과)  {nfc_vol}")

        print(f"=== ⚠️  부분 적재 ({len(partial)}건) ===")
        for line in sorted(partial):
            print(f"  {line}")
        if not partial:
            print("  (없음)")

        print(f"\n=== ✅ 완전 적재 ({len(complete)}건) ===")
        for line in sorted(complete):
            print(f"  {line}")

        if over:
            print(f"\n=== ❗ 초과 적재 ({len(over)}건) ===")
            for line in sorted(over):
                print(f"  {line}")

        if no_source:
            print(f"\n=== ❔ 원본 파일 없음 ({len(no_source)}건) ===")
            for line in sorted(no_source):
                print(f"  {line}")
    else:
        # Qdrant만 조회 (연속성 + 최대 인덱스)
        print(f"{'청크수':>8}  {'max_idx':>8}  {'연속':<6}  파일")
        print("-" * 80)
        for vol, s in sorted(state.items(), key=lambda x: x[0]):
            seq = "✅" if s["is_sequential"] else f"⚠️ gap={s['missing']}"
            print(f"{s['count']:>8,}  {s['max_index']:>8}  {seq:<6}  {vol}")

        print("\n* 원본 파일과 대조하려면: "
              "uv run python scripts/check_upload_status.py /path/to/source/files")


if __name__ == "__main__":
    main()
