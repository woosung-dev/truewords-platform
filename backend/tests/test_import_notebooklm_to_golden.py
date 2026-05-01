"""import_notebooklm_to_golden 단위 테스트 (PR 3).

raw NotebookLM JSON 의 markdown wrapping, 카테고리 분배, source 검증,
queries.json 치환 정확성을 검증.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

# scripts/ 는 패키지가 아니므로 sys.path 조작
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from import_notebooklm_to_golden import (  # noqa: E402
    EXPECTED_CATEGORY_COUNTS,
    INTENDED_CHATBOT,
    INTENDED_SOURCES,
    INTENDED_VOLUMES,
    import_into_target,
    parse_raw_notebooklm,
    validate_entries,
)


def _fake_entries() -> list[dict[str, Any]]:
    """완전한 30 entry 합성 데이터."""
    out = []
    for i in range(1, 13):
        out.append({
            "id": f"f{i:02d}",
            "category": "factoid",
            "query": f"factoid 질문 {i}?",
            "answer_summary": f"factoid 정답 {i}.",
            "source_citations": [
                {"file": "원리강론.txt", "location": "단락", "snippet": f"snippet {i}"},
            ],
        })
    for i in range(1, 13):
        out.append({
            "id": f"c{i:02d}",
            "category": "conceptual",
            "query": f"conceptual 질문 {i}?",
            "answer_summary": f"conceptual 정답 {i}.",
            "source_citations": [
                {"file": "천성경.pdf", "location": "단락", "snippet": f"snippet c{i}"},
            ],
        })
    for i in range(1, 7):
        out.append({
            "id": f"r{i:02d}",
            "category": "reasoning",
            "query": f"reasoning 질문 {i}?",
            "answer_summary": f"reasoning 정답 {i}.",
            "source_citations": [
                {"file": "원리강론.txt", "location": "단락", "snippet": f"snippet r{i}-a"},
                {"file": "평화경.txt", "location": "단락", "snippet": f"snippet r{i}-b"},
            ],
        })
    return out


def _placeholder_target() -> dict[str, Any]:
    """기존 queries.json 의 placeholder 형태 (30 entry)."""
    queries = []
    for i in range(1, 13):
        queries.append({"id": f"f{i:02d}", "category": "factoid", "query": "TODO", "expected_chunk_ids": [], "expected_volumes": [], "notes": ""})
    for i in range(1, 13):
        queries.append({"id": f"c{i:02d}", "category": "conceptual", "query": "TODO", "expected_chunk_ids": [], "expected_volumes": [], "notes": ""})
    for i in range(1, 7):
        queries.append({"id": f"r{i:02d}", "category": "reasoning", "query": "TODO", "expected_chunk_ids": [], "expected_volumes": [], "notes": ""})
    return {"version": 1, "purpose": "old", "queries": queries}


# ── parse_raw_notebooklm ────────────────────────────────────────────────────


def test_parse_raw_strips_markdown_wrapper(tmp_path):
    p = tmp_path / "raw.json"
    p.write_text('```json\n[{"id": "f01"}]\n```\n', encoding="utf-8")
    out = parse_raw_notebooklm(p)
    assert out == [{"id": "f01"}]


def test_parse_raw_plain_json(tmp_path):
    p = tmp_path / "raw.json"
    p.write_text('[{"id": "f01"}]', encoding="utf-8")
    out = parse_raw_notebooklm(p)
    assert out == [{"id": "f01"}]


def test_parse_raw_rejects_non_list(tmp_path):
    p = tmp_path / "raw.json"
    p.write_text('{"id": "f01"}', encoding="utf-8")
    with pytest.raises(ValueError, match="list 가 아님"):
        parse_raw_notebooklm(p)


# ── validate_entries ────────────────────────────────────────────────────────


def test_validate_accepts_valid_30_entries():
    validate_entries(_fake_entries(), strict_30=True)


def test_validate_strict_30_rejects_wrong_count():
    entries = _fake_entries()[:29]
    with pytest.raises(ValueError, match="strict-30"):
        validate_entries(entries, strict_30=True)


def test_validate_rejects_missing_required_field():
    entries = _fake_entries()
    entries[0]["query"] = ""
    with pytest.raises(ValueError, match="query"):
        validate_entries(entries)


def test_validate_strict_30_rejects_wrong_category_distribution():
    entries = _fake_entries()
    entries[0]["category"] = "conceptual"  # factoid 11 / conceptual 13 → 분배 깨짐
    with pytest.raises(ValueError, match="분배 불일치"):
        validate_entries(entries, strict_30=True)


def test_validate_rejects_source_outside_intended_volumes():
    entries = _fake_entries()
    entries[0]["source_citations"][0]["file"] = "다른봇자료.pdf"
    with pytest.raises(ValueError, match="INTENDED_VOLUMES 외부"):
        validate_entries(entries)


def test_validate_rejects_empty_source_citations():
    entries = _fake_entries()
    entries[0]["source_citations"] = []
    with pytest.raises(ValueError, match="source_citations 비어있음"):
        validate_entries(entries)


def test_expected_category_counts_match_master_plan():
    """마스터 plan PR 3 분배 (factoid 12 / conceptual 12 / reasoning 6)."""
    assert EXPECTED_CATEGORY_COUNTS == {"factoid": 12, "conceptual": 12, "reasoning": 6}
    assert sum(EXPECTED_CATEGORY_COUNTS.values()) == 30


# ── import_into_target ─────────────────────────────────────────────────────


def test_import_replaces_query_text_preserving_id_and_category(tmp_path):
    target_path = tmp_path / "queries.json"
    target_path.write_text(json.dumps(_placeholder_target()), encoding="utf-8")

    out = import_into_target(_fake_entries(), target_path)

    assert len(out["queries"]) == 30
    f01 = next(q for q in out["queries"] if q["id"] == "f01")
    assert f01["category"] == "factoid"
    assert f01["query"] == "factoid 질문 1?"
    assert f01["answer_summary"] == "factoid 정답 1."
    assert f01["expected_snippets"] == [
        {"file": "원리강론.txt", "snippet": "snippet 1"}
    ]
    # chunk_id/volume 은 별도 매칭 단계에서 채움 → 비어있어야 함
    assert f01["expected_chunk_ids"] == []
    assert f01["expected_volumes"] == []


def test_import_adds_intended_chatbot_metadata(tmp_path):
    target_path = tmp_path / "queries.json"
    target_path.write_text(json.dumps(_placeholder_target()), encoding="utf-8")

    out = import_into_target(_fake_entries(), target_path)

    assert out["intended_chatbot"] == INTENDED_CHATBOT
    assert out["intended_sources"] == INTENDED_SOURCES
    assert out["intended_volumes"] == INTENDED_VOLUMES
    assert out["version"] == 2  # placeholder 1 → 2 로 bump


def test_import_replace_rejects_id_mismatch(tmp_path):
    target_path = tmp_path / "queries.json"
    target_path.write_text(json.dumps(_placeholder_target()), encoding="utf-8")

    entries = _fake_entries()
    entries[0]["id"] = "f99"  # placeholder 에 없는 id
    with pytest.raises(ValueError, match="placeholder 만 있음|incoming 만 있음"):
        import_into_target(entries, target_path, mode="replace")


def test_import_rejects_category_mismatch_within_id(tmp_path):
    target_path = tmp_path / "queries.json"
    target_path.write_text(json.dumps(_placeholder_target()), encoding="utf-8")

    entries = _fake_entries()
    # f01 의 category 만 placeholder (factoid) 와 다르게 conceptual 로
    entries[0]["category"] = "conceptual"
    # validate 통과 위해 c01 도 factoid 로 swap (분배 유지)
    c01_idx = next(i for i, e in enumerate(entries) if e["id"] == "c01")
    entries[c01_idx]["category"] = "factoid"
    with pytest.raises(ValueError, match="category 불일치"):
        import_into_target(entries, target_path, mode="replace")


# ── Merge mode tests (PR 6.5) ──────────────────────────────────────────────


def test_validate_default_mode_accepts_60_entries():
    """60 entry (v1+v2) 가 strict_30 미지정 시 통과."""
    entries = _fake_entries()
    # f13-f24, c13-c24, r07-r12 추가 → 60 entry
    for i in range(13, 25):
        entries.append({
            "id": f"f{i:02d}",
            "category": "factoid",
            "query": f"q {i}",
            "answer_summary": f"a {i}",
            "source_citations": [{"file": "원리강론.txt", "snippet": f"s{i}"}],
        })
    for i in range(13, 25):
        entries.append({
            "id": f"c{i:02d}",
            "category": "conceptual",
            "query": f"q c{i}",
            "answer_summary": f"a c{i}",
            "source_citations": [{"file": "천성경.pdf", "snippet": f"s c{i}"}],
        })
    for i in range(7, 13):
        entries.append({
            "id": f"r{i:02d}",
            "category": "reasoning",
            "query": f"q r{i}",
            "answer_summary": f"a r{i}",
            "source_citations": [{"file": "평화경.txt", "snippet": f"s r{i}"}],
        })
    validate_entries(entries, strict_30=False)


def test_validate_rejects_duplicate_id():
    entries = _fake_entries()
    dup = dict(entries[0])
    dup["source_citations"] = [{"file": "원리강론.txt", "snippet": "다른 인용"}]
    entries.append(dup)
    with pytest.raises(ValueError, match="중복"):
        validate_entries(entries, strict_30=False)


def test_validate_rejects_invalid_category():
    entries = _fake_entries()
    entries[0]["category"] = "factoids"  # typo
    with pytest.raises(ValueError, match="허용 카테고리 외부"):
        validate_entries(entries, strict_30=False)


def test_merge_mode_appends_new_ids(tmp_path):
    target_path = tmp_path / "queries.json"
    existing = {
        "version": 1,
        "purpose": "test",
        "queries": [
            {"id": "f01", "category": "factoid", "query": "기존",
             "answer_summary": "기존", "expected_snippets": [],
             "expected_chunk_ids": [], "expected_volumes": [], "notes": ""},
        ],
    }
    target_path.write_text(json.dumps(existing), encoding="utf-8")

    entries = [
        {"id": "f01", "category": "factoid", "query": "갱신 q", "answer_summary": "갱신 a",
         "source_citations": [{"file": "원리강론.txt", "snippet": "s1"}]},
        {"id": "f02", "category": "factoid", "query": "신규 q", "answer_summary": "신규 a",
         "source_citations": [{"file": "원리강론.txt", "snippet": "s2"}]},
    ]
    out = import_into_target(entries, target_path, mode="merge")
    assert len(out["queries"]) == 2
    by_id = {q["id"]: q for q in out["queries"]}
    assert by_id["f01"]["query"] == "갱신 q"  # incoming update
    assert by_id["f02"]["query"] == "신규 q"  # 신규 append


def test_merge_mode_preserves_existing_chunk_ids(tmp_path, capsys):
    target_path = tmp_path / "queries.json"
    existing = {
        "version": 1,
        "purpose": "test",
        "queries": [{
            "id": "f01", "category": "factoid", "query": "기존",
            "answer_summary": "기존",
            "expected_snippets": [{"file": "원리강론.txt", "snippet": "기존 인용"}],
            "expected_chunk_ids": ["원리강론.txt:42"],
            "expected_volumes": [],
            "notes": "",
        }],
    }
    target_path.write_text(json.dumps(existing), encoding="utf-8")

    entries = [{
        "id": "f01", "category": "factoid", "query": "갱신 q", "answer_summary": "갱신 a",
        "source_citations": [{"file": "원리강론.txt", "snippet": "갱신된 인용"}],
    }]
    out = import_into_target(entries, target_path, mode="merge")
    by_id = {q["id"]: q for q in out["queries"]}
    assert by_id["f01"]["expected_chunk_ids"] == ["원리강론.txt:42"]
    assert by_id["f01"]["expected_snippets"][0]["snippet"] == "갱신된 인용"
    assert by_id["f01"]["query"] == "갱신 q"
    captured = capsys.readouterr()
    assert "f01" in captured.out


def test_merge_mode_rejects_category_change(tmp_path):
    target_path = tmp_path / "queries.json"
    existing = {
        "version": 1,
        "purpose": "test",
        "queries": [{
            "id": "f01", "category": "factoid", "query": "",
            "answer_summary": "", "expected_snippets": [],
            "expected_chunk_ids": [], "expected_volumes": [], "notes": "",
        }],
    }
    target_path.write_text(json.dumps(existing), encoding="utf-8")
    entries = [{
        "id": "f01", "category": "conceptual", "query": "q", "answer_summary": "a",
        "source_citations": [{"file": "원리강론.txt", "snippet": "s"}],
    }]
    with pytest.raises(ValueError, match="merge category 불일치"):
        import_into_target(entries, target_path, mode="merge")


def test_unknown_mode_raises(tmp_path):
    target_path = tmp_path / "queries.json"
    target_path.write_text(json.dumps({"queries": []}), encoding="utf-8")
    with pytest.raises(ValueError, match="mode="):
        import_into_target([], target_path, mode="bogus")
