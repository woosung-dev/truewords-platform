"""NotebookLM 출력 (raw JSON) → backend/tests/golden/queries.json 변환.

두 가지 모드:

* ``--mode replace`` (PR 3 origin) — 30 placeholder 자리에 30 entry 1:1 치환.
  ``--strict-30`` 와 함께 EXPECTED_CATEGORY_COUNTS (12/12/6) 검증.

* ``--mode merge`` (PR 6.5 신규) — 기존 queries 와 ID 단위 합집합. 신규 ID 는
  append, 중복 ID 는 incoming 으로 update. ``expected_chunk_ids`` 가 채워진 entry
  와 incoming 충돌 시 경고 + 기존 보존 (matcher 결과 보호).

* 공통: id, category, query, answer_summary, expected_snippets 만 갱신.
* expected_chunk_ids/volumes 는 비워둠 — 이후 match_snippets_to_chunks.py 가
  Qdrant 검색으로 채움.
* top-level 메타데이터에 intended_chatbot, intended_sources 추가.

사용:
    cd backend
    # 30 entry replace (strict)
    uv run python scripts/import_notebooklm_to_golden.py \\
        --raw tests/golden/raw/notebooklm-v1.json \\
        --mode replace --strict-30

    # 60 entry merge (multi-raw)
    uv run python scripts/import_notebooklm_to_golden.py \\
        --raw tests/golden/raw/notebooklm-v1.json tests/golden/raw/notebooklm-v2.json \\
        --mode merge
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

INTENDED_CHATBOT = "신학/원리 전문 봇"
INTENDED_SOURCES = ["U"]
INTENDED_VOLUMES = [
    "원리강론.txt",
    "천성경.pdf",
    "평화경.txt",
    "하늘 섭리로 본 참부모님의 위상과 가치.pdf",
]
EXPECTED_CATEGORY_COUNTS = {"factoid": 12, "conceptual": 12, "reasoning": 6}


def parse_raw_notebooklm(path: Path) -> list[dict[str, Any]]:
    """raw NotebookLM 응답 (markdown ```json wrap 또는 plain JSON 둘 다 지원)."""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"```json\s*(.+?)\s*```", text, re.DOTALL)
    payload = m.group(1) if m else text
    data = json.loads(payload)
    if not isinstance(data, list):
        raise ValueError(f"raw 가 list 가 아님: {type(data)}")
    return data


def validate_entries(
    entries: list[dict[str, Any]],
    *,
    strict_30: bool = False,
    valid_categories: set[str] | None = None,
) -> None:
    """필수 필드 + INTENDED_VOLUMES 검증. ``strict_30`` 일 때만 30 + 12/12/6 분배 검증.

    Args:
        entries: 검증할 entry 리스트.
        strict_30: True 면 len==30 + EXPECTED_CATEGORY_COUNTS 일치 강제.
        valid_categories: 허용 category set. None 이면 EXPECTED_CATEGORY_COUNTS 키.
    """
    valid_categories = valid_categories or set(EXPECTED_CATEGORY_COUNTS.keys())

    if strict_30 and len(entries) != 30:
        raise ValueError(f"--strict-30 mode 에서 entries 30개 기대, 실제 {len(entries)}")

    seen_ids: set[str] = set()
    counts: dict[str, int] = {}
    for e in entries:
        for field in ("id", "category", "query", "answer_summary"):
            if not e.get(field):
                raise ValueError(f"id={e.get('id')} 의 {field} 누락 또는 빈 값")
        if e["id"] in seen_ids:
            raise ValueError(f"id={e['id']} 중복 — 다중 raw 파일 ID 충돌")
        seen_ids.add(e["id"])
        if e["category"] not in valid_categories:
            raise ValueError(
                f"id={e['id']} category={e['category']!r} 가 허용 카테고리 외부: {valid_categories}"
            )
        counts[e["category"]] = counts.get(e["category"], 0) + 1
        if not isinstance(e.get("source_citations"), list) or not e["source_citations"]:
            raise ValueError(f"id={e['id']} source_citations 비어있음")
        for c in e["source_citations"]:
            for field in ("file", "snippet"):
                if not c.get(field):
                    raise ValueError(f"id={e['id']} source_citations 의 {field} 누락")
            if c["file"] not in INTENDED_VOLUMES:
                raise ValueError(
                    f"id={e['id']} 의 source file={c['file']!r} 가 "
                    f"INTENDED_VOLUMES 외부 — 다른 챗봇 영역 자료 가능성"
                )

    if strict_30:
        for cat, expected in EXPECTED_CATEGORY_COUNTS.items():
            actual = counts.get(cat, 0)
            if actual != expected:
                raise ValueError(
                    f"--strict-30 category={cat!r} 분배 불일치: 기대 {expected}, 실제 {actual}"
                )


def _build_query_record(
    entry: dict[str, Any], category: str, notes: str = "",
) -> dict[str, Any]:
    """incoming entry 를 queries.json 의 query record 형태로 변환."""
    return {
        "id": entry["id"],
        "category": category,
        "query": entry["query"],
        "answer_summary": entry["answer_summary"],
        "expected_snippets": [
            {"file": c["file"], "snippet": c["snippet"]}
            for c in entry["source_citations"]
        ],
        # match_snippets_to_chunks.py 가 채울 영역
        "expected_chunk_ids": [],
        "expected_volumes": [],
        "notes": notes,
    }


def import_into_target(
    entries: list[dict[str, Any]], target_path: Path, *, mode: str = "replace",
) -> dict[str, Any]:
    """queries.json 갱신.

    Args:
        entries: 검증된 NotebookLM raw entries.
        target_path: queries.json 경로.
        mode: ``replace`` (placeholder set 일치 강제 + 1:1 치환) 또는
              ``merge`` (ID 단위 합집합, 신규 append, 중복 update,
              expected_chunk_ids 채워진 entry 는 보존).
    """
    if mode not in ("replace", "merge"):
        raise ValueError(f"mode={mode!r} 미지원 — 'replace' 또는 'merge'")

    target = json.loads(target_path.read_text(encoding="utf-8"))
    existing_by_id: dict[str, dict[str, Any]] = {
        q["id"]: q for q in target.get("queries", [])
    }
    incoming_by_id: dict[str, dict[str, Any]] = {e["id"]: e for e in entries}

    if mode == "replace":
        if set(existing_by_id) != set(incoming_by_id):
            missing = set(existing_by_id) - set(incoming_by_id)
            extra = set(incoming_by_id) - set(existing_by_id)
            raise ValueError(
                f"replace mode id 불일치 — placeholder 만 있음: {sorted(missing)}, "
                f"incoming 만 있음: {sorted(extra)}"
            )
        new_queries: list[dict[str, Any]] = []
        for q_id, placeholder in existing_by_id.items():
            incoming = incoming_by_id[q_id]
            if placeholder["category"] != incoming["category"]:
                raise ValueError(
                    f"id={q_id} category 불일치: placeholder={placeholder['category']!r}, "
                    f"incoming={incoming['category']!r}"
                )
            new_queries.append(
                _build_query_record(
                    incoming, placeholder["category"], placeholder.get("notes", ""),
                )
            )
    else:  # merge
        new_queries = []
        # 1) 기존 entry — incoming 에 없으면 그대로, 있으면 업데이트 분기
        for q_id, existing in existing_by_id.items():
            if q_id not in incoming_by_id:
                new_queries.append(existing)
                continue
            incoming = incoming_by_id[q_id]
            existing_category = existing.get("category")
            if existing_category and existing_category != incoming["category"]:
                raise ValueError(
                    f"id={q_id} merge category 불일치: existing={existing_category!r}, "
                    f"incoming={incoming['category']!r}"
                )
            # expected_chunk_ids 채워져 있으면 보존, snippet 만 incoming 으로 갱신
            if existing.get("expected_chunk_ids") or existing.get("expected_volumes"):
                print(
                    f"⚠ id={q_id}: expected_chunk_ids/volumes 채워진 entry — "
                    "snippet 만 incoming 으로 갱신, 기존 chunk_id 보존"
                )
                merged = dict(existing)
                merged["query"] = incoming["query"]
                merged["answer_summary"] = incoming["answer_summary"]
                merged["expected_snippets"] = [
                    {"file": c["file"], "snippet": c["snippet"]}
                    for c in incoming["source_citations"]
                ]
                new_queries.append(merged)
            else:
                new_queries.append(
                    _build_query_record(
                        incoming, incoming["category"], existing.get("notes", ""),
                    )
                )
        # 2) 신규 entry append
        existing_ids = set(existing_by_id.keys())
        for q_id, incoming in incoming_by_id.items():
            if q_id in existing_ids:
                continue
            new_queries.append(_build_query_record(incoming, incoming["category"]))

    target["version"] = target.get("version", 1) + 1
    target["intended_chatbot"] = INTENDED_CHATBOT
    target["intended_sources"] = INTENDED_SOURCES
    target["intended_volumes"] = INTENDED_VOLUMES
    target["purpose"] = (
        "Reranker A/B (PR 7) 측정용 골든셋. "
        f"챗봇={INTENDED_CHATBOT} (sources={INTENDED_SOURCES}). "
        "NotebookLM 으로 60 질문 (v1+v2), expected_chunk_ids 는 별도 매칭 단계에서 채움."
    )
    target["labeling_policy"] = (
        "expected_snippets 는 NotebookLM 인용 원문. expected_chunk_ids 는 "
        "scripts/match_snippets_to_chunks.py 가 Qdrant fuzzy match 로 자동 채움 + 사람 검수."
    )
    target["queries"] = new_queries
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="NotebookLM 출력 → backend/tests/golden/queries.json import",
    )
    parser.add_argument(
        "--raw",
        nargs="+",
        default=["tests/golden/raw/notebooklm-v1.json"],
        help="raw NotebookLM JSON 경로 (다중 파일 지원, concatenate 후 ID 충돌 검출)",
    )
    parser.add_argument(
        "--target",
        default="tests/golden/queries.json",
        help="대상 queries.json 경로 (default: tests/golden/queries.json)",
    )
    parser.add_argument(
        "--mode",
        choices=("replace", "merge"),
        default="merge",
        help="replace: placeholder set 일치 강제 + 1:1 치환. "
             "merge (default): ID 단위 합집합, 신규 append, expected_chunk_ids 채워진 entry 는 보존.",
    )
    parser.add_argument(
        "--strict-30",
        action="store_true",
        help="entries 30개 + factoid/conceptual/reasoning 12/12/6 분배 강제 검증.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="검증만 하고 파일 쓰지 않음",
    )
    args = parser.parse_args(argv)

    raw_paths = [Path(r) for r in args.raw]
    target_path = Path(args.target)

    entries: list[dict[str, Any]] = []
    for p in raw_paths:
        entries.extend(parse_raw_notebooklm(p))
    print(f"✓ {len(raw_paths)} raw 파일에서 {len(entries)} entries 로드")

    validate_entries(entries, strict_30=args.strict_30)
    if args.strict_30:
        print(f"✓ --strict-30 검증 통과 (factoid 12 / conceptual 12 / reasoning 6)")
    else:
        print(f"✓ 필수 필드 + 카테고리 + INTENDED_VOLUMES + ID 중복 검증 통과")

    updated = import_into_target(entries, target_path, mode=args.mode)
    print(
        f"✓ queries.json 갱신 준비 완료: mode={args.mode}, "
        f"version={updated['version']}, n_queries={len(updated['queries'])}, "
        f"intended_chatbot={updated['intended_chatbot']!r}"
    )

    if args.dry_run:
        print("(--dry-run) 파일 쓰지 않음.")
        return 0

    target_path.write_text(
        json.dumps(updated, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"✓ 저장 완료: {target_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
