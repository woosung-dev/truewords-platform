"""raw 파일 폴더 ↔ malssum_poc volume payload 매칭.

옵션 F (paragraph) 본 가동을 위해 raw 보유 권 (paragraph 재청킹) vs 미보유 권
(sentence vector copy) 분류.

매칭 전략:
1. '문선명선생 말씀선집/' 하위 raw 파일 → 권수 추출 (예: '001권' → 1)
   → malssum_poc volume에서 같은 권수 + '말씀선집' 키워드 → 매칭
2. 그 외 카테고리 raw 파일 → NFC 정규화 + 파일명/stem 매칭

출력 (--output-dir):
  - matched.json: [{"raw_path": "...", "volume": "..."}, ...]
  - unmatched_raw.json: [...]
  - unmatched_volumes.json: [...]

사용 예:
    PYTHONPATH=. uv run python scripts/match_raw_to_volumes.py \\
        --raw-dir "/Users/woosung/Downloads/말씀(포너즈)" \\
        --output-dir ../tmp_match
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

from src.qdrant_client import get_client


SUPPORTED_EXT = {".txt", ".pdf", ".docx"}
MALSSUM_FOLDER_NAME = "문선명선생 말씀선집"  # 권수 매칭 적용 폴더
PATTERN_VOLUME_NUM = re.compile(r"(\d{1,3})\s*권")


def normalize_name(name: str) -> str:
    """NFC 통일 + lowercase + 공백 정리. 매칭 키로 사용."""
    return unicodedata.normalize("NFC", name).strip().lower()


def extract_volume_number(name: str) -> int | None:
    """파일명에서 'N권' 패턴의 권수 추출. 없으면 None."""
    name_nfc = unicodedata.normalize("NFC", name)
    m = PATTERN_VOLUME_NUM.search(name_nfc)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return None
    return None


def is_malssum_volume(volume: str) -> bool:
    """malssum_poc volume이 말씀선집 권 패턴인지 (권수 매칭 대상)."""
    n = unicodedata.normalize("NFC", volume)
    # '말씀선집' 키워드 또는 '_권' 패턴 (예: '159 권.pdf')
    return "말씀선집" in n or PATTERN_VOLUME_NUM.search(n) is not None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", required=True, type=Path)
    parser.add_argument("--collection", default="malssum_poc")
    parser.add_argument("--output-dir", default=Path("."), type=Path)
    args = parser.parse_args()

    if not args.raw_dir.exists():
        print(f"raw-dir 없음: {args.raw_dir}", file=sys.stderr)
        return 1

    # raw 파일 스캔 (지원 확장자만, macOS resource fork .__로 시작하는 파일 제외)
    raw_files: list[Path] = []
    for p in args.raw_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXT and not p.name.startswith("._"):
            raw_files.append(p)
    print(f"raw 파일 수: {len(raw_files)} (지원 확장자 {SUPPORTED_EXT})")

    # malssum_poc volumes 추출
    client = get_client()
    all_vols: set[str] = set()
    offset = None
    while True:
        points, offset = client.scroll(
            args.collection,
            limit=2000,
            with_payload=["volume"],
            with_vectors=False,
            offset=offset,
        )
        for p in points:
            payload = p.payload or {}
            v = payload.get("volume")
            if v:
                all_vols.add(str(v))
        if offset is None:
            break
    print(f"malssum_poc unique volumes: {len(all_vols)}")

    # raw 파일 인덱스 구축
    # 1. 일반 매칭용: 파일명 + stem
    raw_idx_full: dict[str, Path] = {}
    raw_idx_stem: dict[str, Path] = {}
    # 2. 말씀선집 권수 매칭용: 폴더 = 문선명선생 말씀선집 하위인 raw 파일을 권수로 매핑
    raw_idx_volume_num: dict[int, Path] = {}

    for f in raw_files:
        raw_idx_full[normalize_name(f.name)] = f
        raw_idx_stem[normalize_name(f.stem)] = f

        # 부모 경로에 '문선명선생 말씀선집'이 있는지 확인 (NFC 비교)
        parts_nfc = [unicodedata.normalize("NFC", p) for p in f.parts]
        if any(MALSSUM_FOLDER_NAME in p for p in parts_nfc):
            num = extract_volume_number(f.name)
            if num is not None and num not in raw_idx_volume_num:
                raw_idx_volume_num[num] = f

    print(f"말씀선집 권수 인덱스: {len(raw_idx_volume_num)}권 ({min(raw_idx_volume_num)}~{max(raw_idx_volume_num)} 권)" if raw_idx_volume_num else "말씀선집 권수 인덱스: (비어있음)")

    matched: list[dict] = []
    unmatched_vol: list[str] = []
    used_raw: set[str] = set()

    for vorig in sorted(all_vols):
        match: Path | None = None

        # 1. 정확 매칭 (파일명 전체 또는 stem)
        vn = normalize_name(vorig)
        if vn in raw_idx_full:
            match = raw_idx_full[vn]
        elif vn in raw_idx_stem:
            match = raw_idx_stem[vn]
        else:
            # volume이 .txt/.pdf 확장자 가졌으면 stem 매칭 시도
            for ext in SUPPORTED_EXT:
                if vn.endswith(ext) and vn[: -len(ext)] in raw_idx_stem:
                    match = raw_idx_stem[vn[: -len(ext)]]
                    break

        # 2. 말씀선집 권수 매칭 (이름 매칭 실패한 말씀선집 권에 한해)
        if match is None and is_malssum_volume(vorig):
            num = extract_volume_number(vorig)
            if num is not None and num in raw_idx_volume_num:
                match = raw_idx_volume_num[num]

        if match and str(match) not in used_raw:
            matched.append({"raw_path": str(match), "volume": vorig})
            used_raw.add(str(match))
        else:
            unmatched_vol.append(vorig)

    unmatched_raw = [str(f) for f in raw_files if str(f) not in used_raw]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "matched.json").write_text(
        json.dumps(matched, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (args.output_dir / "unmatched_raw.json").write_text(
        json.dumps(unmatched_raw, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (args.output_dir / "unmatched_volumes.json").write_text(
        json.dumps(unmatched_vol, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print()
    print("=== 매칭 결과 ===")
    print(f"  매칭: {len(matched)}")
    print(f"  미매칭 raw: {len(unmatched_raw)}")
    print(f"  미매칭 volume: {len(unmatched_vol)}")
    print()
    print("=== 매칭 sample (first 5) ===")
    for m in matched[:5]:
        print(f"  {m['volume']} ← {m['raw_path']}")
    print()
    print("=== 미매칭 volume sample (first 10) ===")
    for v in unmatched_vol[:10]:
        print(f"  {v}")
    print()
    print(f"출력: {args.output_dir.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
