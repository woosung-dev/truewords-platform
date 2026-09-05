"""권별 prefix JSONL을 Chunk 객체로 변환하는 헬퍼 검증."""
from __future__ import annotations

import json
from pathlib import Path

from scripts.reindex_with_prefix import jsonl_to_chunks


def test_jsonl_to_chunks_preserves_prefix_text(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text(
        json.dumps({
            "text": "원문",
            "volume": "v1",
            "chunk_index": 0,
            "source": ["B"],
            "title": "t",
            "date": "1956",
            "prefix_text": "PREFIX",
        }) + "\n",
        encoding="utf-8",
    )
    chunks = jsonl_to_chunks(p)
    assert len(chunks) == 1
    assert chunks[0].prefix_text == "PREFIX"
    assert chunks[0].text == "원문"
    assert chunks[0].source == ["B"]
    assert chunks[0].volume == "v1"
    assert chunks[0].chunk_index == 0


def test_jsonl_to_chunks_skips_blank_lines(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text(
        "\n" + json.dumps({"text": "t", "volume": "v", "chunk_index": 0}) + "\n\n",
        encoding="utf-8",
    )
    assert len(jsonl_to_chunks(p)) == 1


def test_jsonl_to_chunks_empty_file(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text("", encoding="utf-8")
    assert jsonl_to_chunks(p) == []


def test_jsonl_to_chunks_missing_file(tmp_path: Path) -> None:
    p = tmp_path / "missing.jsonl"
    assert jsonl_to_chunks(p) == []
