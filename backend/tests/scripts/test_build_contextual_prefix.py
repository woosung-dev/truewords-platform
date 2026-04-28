"""build_contextual_prefix 단위 테스트."""
from __future__ import annotations

import json
from pathlib import Path

from scripts.build_contextual_prefix import (
    build_prompt,
    iter_chunks_from_volume_jsonl,
    parse_prefix_response,
)


def test_build_prompt_inserts_full_doc_and_chunk() -> None:
    prompt = build_prompt(
        full_doc="A B C 1956년 10월 3일 강의록", chunk_text="C", chunk_index=2
    )
    assert "<document>" in prompt and "A B C 1956년 10월 3일 강의록" in prompt
    assert "<chunk>C</chunk>" in prompt
    assert "한국어" in prompt and ("시기" in prompt or "장소" in prompt or "주제" in prompt)


def test_parse_prefix_response_strips_whitespace_and_caps_length() -> None:
    raw = "  이 청크는 1956년 10월 3일 '말씀선집 007권' 강의 중 참조상 개념을 다룬다.  "
    out = parse_prefix_response(raw)
    assert out.startswith("이 청크는")
    assert not out.endswith(" ")


def test_parse_prefix_response_truncates_long_output() -> None:
    raw = "긴 문장. " * 100  # ~700자
    out = parse_prefix_response(raw)
    assert len(out) <= 400


def test_iter_chunks_from_volume_jsonl_yields_dicts(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text(
        json.dumps({"chunk_index": 0, "text": "t1"}) + "\n" +
        json.dumps({"chunk_index": 1, "text": "t2"}) + "\n",
        encoding="utf-8",
    )
    items = list(iter_chunks_from_volume_jsonl(p))
    assert [i["chunk_index"] for i in items] == [0, 1]
    assert items[0]["text"] == "t1"


def test_iter_chunks_from_volume_jsonl_handles_blank_lines(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text("\n" + json.dumps({"chunk_index": 0, "text": "t1"}) + "\n\n", encoding="utf-8")
    items = list(iter_chunks_from_volume_jsonl(p))
    assert len(items) == 1
