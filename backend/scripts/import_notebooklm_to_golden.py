"""NotebookLM 출력 (raw JSON) → backend/tests/golden/queries.json 변환 (PR 3).

NotebookLM 한테 마스터 plan PR 3 의 프롬프트를 던져 받은 30 entry JSON 을
queries.json 의 30 placeholder 자리에 채운다.

* 보존: id, category 골격은 placeholder 와 동일하므로 query/answer_summary/expected_snippets 만 갱신.
* expected_chunk_ids/volumes 는 비워둠 — 이후 match_snippets_to_chunks.py 가 Qdrant 검색으로 채움.
* top-level 메타데이터에 intended_chatbot, intended_sources 추가.

사용:
    cd backend
    uv run python scripts/import_notebooklm_to_golden.py \\
        --raw tests/golden/raw/notebooklm-v1.json \\
        --target tests/golden/queries.json
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


def validate_entries(entries: list[dict[str, Any]]) -> None:
    """30 entry + 카테고리 분배 + 필수 필드 검증."""
    if len(entries) != 30:
        raise ValueError(f"entries 30개 기대, 실제 {len(entries)}")

    counts: dict[str, int] = {}
    for e in entries:
        # 빈 list 도 source_citations 가 list 임은 인정 → 별도 체크에서 빈 값 reject.
        for field in ("id", "category", "query", "answer_summary"):
            if not e.get(field):
                raise ValueError(f"id={e.get('id')} 의 {field} 누락 또는 빈 값")
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

    for cat, expected in EXPECTED_CATEGORY_COUNTS.items():
        actual = counts.get(cat, 0)
        if actual != expected:
            raise ValueError(f"category={cat!r} 분배 불일치: 기대 {expected}, 실제 {actual}")


def import_into_target(entries: list[dict[str, Any]], target_path: Path) -> dict[str, Any]:
    """기존 queries.json 의 placeholder queries 를 NotebookLM 결과로 치환."""
    target = json.loads(target_path.read_text(encoding="utf-8"))

    # 기존 placeholder 와 NotebookLM 결과 둘 다 id 로 인덱싱
    placeholder_by_id = {q["id"]: q for q in target.get("queries", [])}
    incoming_by_id = {e["id"]: e for e in entries}

    if set(placeholder_by_id) != set(incoming_by_id):
        missing = set(placeholder_by_id) - set(incoming_by_id)
        extra = set(incoming_by_id) - set(placeholder_by_id)
        raise ValueError(
            f"id 불일치 — placeholder 만 있음: {sorted(missing)}, "
            f"NotebookLM 만 있음: {sorted(extra)}"
        )

    new_queries: list[dict[str, Any]] = []
    for q_id, placeholder in placeholder_by_id.items():
        incoming = incoming_by_id[q_id]
        if placeholder["category"] != incoming["category"]:
            raise ValueError(
                f"id={q_id} category 불일치: placeholder={placeholder['category']!r}, "
                f"NotebookLM={incoming['category']!r}"
            )
        new_queries.append({
            "id": q_id,
            "category": placeholder["category"],
            "query": incoming["query"],
            "answer_summary": incoming["answer_summary"],
            "expected_snippets": [
                {"file": c["file"], "snippet": c["snippet"]}
                for c in incoming["source_citations"]
            ],
            # match_snippets_to_chunks.py 가 채울 영역
            "expected_chunk_ids": [],
            "expected_volumes": [],
            "notes": placeholder.get("notes", ""),
        })

    target["version"] = target.get("version", 1) + 1
    target["intended_chatbot"] = INTENDED_CHATBOT
    target["intended_sources"] = INTENDED_SOURCES
    target["intended_volumes"] = INTENDED_VOLUMES
    target["purpose"] = (
        "Reranker A/B (PR 7) 측정용 골든셋. "
        f"챗봇={INTENDED_CHATBOT} (sources={INTENDED_SOURCES}). "
        "NotebookLM 으로 30 질문 1차 생성, expected_chunk_ids 는 별도 매칭 단계에서 채움."
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
        default="tests/golden/raw/notebooklm-v1.json",
        help="raw NotebookLM JSON 경로 (default: tests/golden/raw/notebooklm-v1.json)",
    )
    parser.add_argument(
        "--target",
        default="tests/golden/queries.json",
        help="대상 queries.json 경로 (default: tests/golden/queries.json)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="검증만 하고 파일 쓰지 않음",
    )
    args = parser.parse_args(argv)

    raw_path = Path(args.raw)
    target_path = Path(args.target)

    entries = parse_raw_notebooklm(raw_path)
    validate_entries(entries)
    print(f"✓ {len(entries)} entries 검증 통과 (factoid 12 / conceptual 12 / reasoning 6)")

    updated = import_into_target(entries, target_path)
    print(f"✓ queries.json 갱신 준비 완료: version={updated['version']}, "
          f"intended_chatbot={updated['intended_chatbot']!r}")

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
